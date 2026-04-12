import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  CompilerOutput,
  Dialect,
  FileProvenance,
  NamespacePlugin,
  ResolvedConfig,
  SqlStatement,
} from '@sqldoc/core'
import {
  compile,
  debug,
  findSqldocDir,
  loadImports,
  parse,
  parseDirectives,
  resolveDirectives,
  SqlparserTsAdapter,
  validate,
} from '@sqldoc/core'
import type { Realm, Schema } from '@sqldoc/db'
import { createRunner, extractExtensions } from '@sqldoc/db'
import pc from 'picocolors'
import { installPackages, promptAndInstallMissing, promptInstall } from './auto-install.ts'
import { discoverSqlFiles } from './discover.ts'
import { formatDiagnostic } from './format.ts'

function defaultSchemaForDialect(dialect: Dialect): string | undefined {
  switch (dialect) {
    case 'postgres':
      return 'public'
    case 'mssql':
      return 'dbo'
    default:
      return undefined
  }
}

/** Result from running the compile pipeline */
export interface PipelineResult {
  /** All mergedSql joined with newline */
  mergedSql: string
  /** All per-file CompilerOutput objects */
  outputs: CompilerOutput[]
  /** All loaded plugins keyed by namespace name */
  plugins: Map<string, NamespacePlugin>
  /** Count of errors encountered */
  totalErrors: number
  /** Atlas realm from initial inspect (pre-compile schema) */
  atlasRealm?: Realm
  /** Set of external object names (from externalRealm). Empty when no @external directives. */
  externalObjectNames: Set<string>
  /** File provenance map (absolute path -> provenance) */
  provenanceMap: Map<string, FileProvenance>
}

/**
 * Run the full sqldoc compile pipeline: discover files, parse, validate, compile.
 *
 * This is the core logic extracted from the codegen command for reuse by
 * both `codegen` and `migrate` commands. It does NOT handle:
 * - afterCompile hooks
 * - process.exit
 *
 * Those concerns remain in the caller.
 */
export async function runCompilePipeline(
  inputPath: string,
  config: ResolvedConfig,
  configRoot: string,
): Promise<PipelineResult> {
  debug('pipeline', `runCompilePipeline: input=${inputPath}, dialect=${config.dialect}`)
  // Discover SQL files
  const sqlFiles = await discoverSqlFiles(inputPath, config.include, configRoot)
  if (sqlFiles.length === 0) {
    console.error(pc.yellow('No SQL files found'))
    return {
      mergedSql: '',
      outputs: [],
      plugins: new Map(),
      totalErrors: 0,
      externalObjectNames: new Set(),
      provenanceMap: new Map(),
    }
  }

  // Initialize AST adapter once
  const adapter = new SqlparserTsAdapter(config.dialect)
  await adapter.init()

  // ── Resolve @external and @include directives ──────────────────────
  const resolved = await resolveDirectives(sqlFiles, (f) => fs.readFileSync(f, 'utf-8'))
  const hasExternals = resolved.externalFiles.length > 0
  debug('pipeline', `directives: ${resolved.externalFiles.length} external, ${resolved.includeFiles.length} include`)

  // Build merged content: inline @include content into each project file at the end.
  // This ensures included tables can FK-reference parent tables (they appear after).
  // External files are kept separate — they go to Atlas first as the pre-existing baseline.
  const mergedProjectContents = new Map<string, string>()
  for (const sqlFile of sqlFiles) {
    let content = fs.readFileSync(sqlFile, 'utf-8')
    // Find this file's includes by parsing its directives
    const directives = parseDirectives(content)
    for (const d of directives) {
      if (d.type !== 'include') continue
      const dir = path.dirname(sqlFile)
      const abs = path.resolve(dir, d.path)
      if (resolved.provenanceMap.get(abs) === 'include') {
        const includeContent = fs.readFileSync(abs, 'utf-8')
        content += `\n\n${includeContent}`
      }
    }
    mergedProjectContents.set(sqlFile, content)
  }

  // For Atlas: external files first, then merged project files (includes inlined)
  const allFiles = [...resolved.externalFiles, ...sqlFiles]

  // ── Atlas -- required for compilation ──────────────────────────────
  const dialect = config.dialect
  const allRawContents = allFiles.map((f) =>
    resolved.provenanceMap.get(f) === 'external'
      ? fs.readFileSync(f, 'utf-8')
      : (mergedProjectContents.get(f) ?? fs.readFileSync(f, 'utf-8')),
  )

  // Detect goose migration format and warn once
  if (allRawContents.some((sql) => /^--\s*\+goose\s+(Up|Down)/m.test(sql))) {
    console.error(pc.yellow('Warning: detected goose migration format. Down scripts will be stripped.'))
  }

  const allSqlContents = allRawContents.map(stripMigrationDown)

  const { extensions } = extractExtensions(allSqlContents)
  const sqldocDir = findSqldocDir(configRoot) ?? undefined
  const atlasRunner = await createRunner({
    dialect,
    devUrl: config.devUrl,
    extensions,
    sqldocDir,
    onMissingPlugin: async (packageNameWithVersion: string) => {
      if (!sqldocDir) {
        console.error(pc.yellow('Cannot auto-install: no .sqldoc/ directory found'))
        return false
      }
      if (await promptInstall([packageNameWithVersion])) {
        try {
          await installPackages(sqldocDir, [packageNameWithVersion])
          return true
        } catch {
          return false
        }
      }
      return false
    },
  })

  const mergedOutputs: string[] = []
  const allOutputs: CompilerOutput[] = []
  const allPlugins = new Map<string, NamespacePlugin>()
  let totalErrors = 0
  let atlasRealm: Realm
  const externalObjectNames = new Set<string>()

  try {
    // ── Dual Atlas inspection when @external directives present (D-16, D-17) ──
    let externalRealm: Realm | undefined

    if (hasExternals) {
      // Inspection 1: external files only -> externalRealm
      const externalContents = resolved.externalFiles.map((f) => stripMigrationDown(fs.readFileSync(f, 'utf-8')))
      const externalResult = await atlasRunner.inspect(externalContents, {
        schema: defaultSchemaForDialect(dialect),
      })
      if (!externalResult.schema) {
        throw new Error(externalResult.error ?? 'Atlas failed to parse external schema')
      }
      externalRealm = externalResult.schema as Realm

      // Extract external object names (schema-qualified to avoid cross-schema collisions)
      for (const schema of externalRealm.schemas) {
        for (const table of schema.tables ?? []) externalObjectNames.add(`${schema.name}.${table.name}`)
        for (const view of schema.views ?? []) externalObjectNames.add(`${schema.name}.${view.name}`)
      }
    }

    // Inspection 2 (or sole inspection when no externals): all files -> fullRealm
    // Use zero-padded index prefix so Atlas preserves dependency order when it sorts by filename
    const relFiles = allFiles.map((f, i) => `${String(i).padStart(4, '0')}_${path.relative(process.cwd(), f)}`)
    const inspectResult = await atlasRunner.inspect(allSqlContents, {
      fileNames: relFiles,
    })
    if (!inspectResult.schema) {
      throw new Error(inspectResult.error ?? 'Atlas failed to parse schema')
    }
    if (inspectResult.error) {
      console.error(pc.yellow(inspectResult.error))
    }
    atlasRealm = inspectResult.schema
    debug('pipeline', 'atlas inspect complete')

    // Validate external object immutability (D-18)
    if (hasExternals && externalRealm) {
      validateExternalImmutability(externalRealm, atlasRealm as Realm, externalObjectNames)
    }

    for (const filePath of allFiles) {
      const rel = path.relative(process.cwd(), filePath)
      console.error(pc.cyan(`── ${rel}`))
      // Use merged content (includes inlined) for project files, raw content for externals
      const source = mergedProjectContents.get(filePath) ?? fs.readFileSync(filePath, 'utf-8')

      // Parse tags and imports
      const { imports, tags } = parse(source)

      // Load namespace plugins (with auto-install for missing packages)
      let { namespaces, errors: loadErrors } = await loadImports(
        imports.map((i) => i.path),
        filePath,
      )

      if (loadErrors.length > 0) {
        // Try auto-installing missing packages
        const retryResult = await promptAndInstallMissing(
          loadErrors,
          imports.map((i) => i.path),
          filePath,
        )
        if (retryResult) {
          namespaces = retryResult.namespaces
          loadErrors = retryResult.errors
        }

        // Report any remaining errors
        if (loadErrors.length > 0) {
          for (const err of loadErrors) {
            console.error(pc.red(`Error loading ${err.importPath}: ${err.message}`))
          }
          totalErrors += loadErrors.length
        }
      }

      // Cast TagNamespace to NamespacePlugin (plugins extend TagNamespace)
      const plugins = new Map<string, NamespacePlugin>([...namespaces].map(([k, v]) => [k, v as NamespacePlugin]))

      // Parse SQL AST (supplementary — Atlas is the real schema source)
      let statements: SqlStatement[] = []
      try {
        statements = adapter.parseStatements(source)
      } catch (err: any) {
        console.error(pc.yellow(`AST parse warning in ${rel}: ${err?.message ?? String(err)}`))
      }

      // Validate before compiling
      const diagnostics = validate(tags, namespaces, source, statements)
      for (const d of diagnostics) {
        console.error(formatDiagnostic(filePath, d))
        if (d.severity === 'error') totalErrors++
      }

      // Abort this file if validation errors found
      if (diagnostics.some((d) => d.severity === 'error')) {
        continue
      }

      // Compile with Atlas schema
      const output = compile({ source, filePath, plugins, statements, adapter, config, atlasRealm })

      // Set provenance on each CompilerOutput
      output.provenance = resolved.provenanceMap.get(filePath) ?? 'project'

      mergedOutputs.push(output.mergedSql)
      allOutputs.push(output)
      for (const [name, plugin] of plugins) {
        if (!allPlugins.has(name)) allPlugins.set(name, plugin)
      }

      if (output.errors.length > 0) {
        for (const err of output.errors) {
          console.error(pc.red(`[${err.namespace}] ${err.message}`))
        }
        totalErrors += output.errors.length
      }

      // Write code outputs if any
      if (output.codeOutputs.length > 0) {
        const codeOutDir = config.codeOutDir ?? './sqldoc-out'
        for (const codeOutput of output.codeOutputs) {
          const outPath = path.resolve(codeOutDir, codeOutput.filePath)
          fs.mkdirSync(path.dirname(outPath), { recursive: true })
          fs.writeFileSync(outPath, codeOutput.content, 'utf-8')
        }
      }
    }
  } finally {
    await atlasRunner.close()
  }

  return {
    mergedSql: mergedOutputs.join('\n'),
    outputs: allOutputs,
    plugins: allPlugins,
    totalErrors,
    atlasRealm,
    externalObjectNames,
    provenanceMap: resolved.provenanceMap,
  }
}

/**
 * Strip everything after -- +goose Down (or similar migration tool markers).
 * Only the "up" portion is relevant for schema inspection.
 */
function stripMigrationDown(sql: string): string {
  // Remove -- +goose Up/Down markers and everything after Down
  const downIdx = sql.search(/^--\s*\+goose\s+Down/m)
  const stripped = downIdx === -1 ? sql : sql.substring(0, downIdx).trimEnd()
  // Remove the -- +goose Up marker itself
  return stripped.replace(/^--\s*\+goose\s+Up\s*$/gm, '').trimStart()
}

// -- External object helpers --

/**
 * Normalize an Atlas object (table or view) to a canonical string for comparison.
 * Uses JSON.stringify on sorted column arrays for deep equality.
 */
function normalizeColumns(
  columns: Array<{ name: string; type: { type: { T: string }; raw?: string; null?: boolean } }> | undefined,
): string {
  if (!columns || columns.length === 0) return '[]'
  const sorted = [...columns].sort((a, b) => a.name.localeCompare(b.name))
  return JSON.stringify(
    sorted.map((c) => ({
      name: c.name,
      type: c.type.raw ?? c.type.type.T,
      null: c.type.null,
      default: (c as any).default,
      generated: (c as any).generated,
    })),
  )
}

/**
 * Validate that external objects have not been modified by project or include files (D-18).
 * Compares each external object between the externalRealm and fullRealm.
 * If any difference is detected, throws a hard error.
 */
function validateExternalImmutability(externalRealm: Realm, fullRealm: Realm, externalObjectNames: Set<string>): void {
  // Build lookup maps for full realm objects (schema-qualified keys)
  const fullTables = new Map<string, Schema['tables']>()
  const fullViews = new Map<string, Schema['views']>()
  for (const schema of fullRealm.schemas) {
    for (const table of schema.tables ?? []) fullTables.set(`${schema.name}.${table.name}`, [table])
    for (const view of schema.views ?? []) fullViews.set(`${schema.name}.${view.name}`, [view])
  }

  for (const schema of externalRealm.schemas) {
    for (const extTable of schema.tables ?? []) {
      const qualName = `${schema.name}.${extTable.name}`
      if (!externalObjectNames.has(qualName)) continue
      const fullTableArr = fullTables.get(qualName)
      if (!fullTableArr || fullTableArr.length === 0) {
        throw new Error(
          `External object '${extTable.name}' was removed by a project or include file. External objects are immutable.`,
        )
      }
      const fullTable = fullTableArr[0]

      const extCols = normalizeColumns(extTable.columns)
      const fullCols = normalizeColumns(fullTable.columns)
      if (extCols !== fullCols) {
        throw new Error(
          `External object '${extTable.name}' was modified by a project or include file. External objects are immutable.`,
        )
      }
    }

    for (const extView of schema.views ?? []) {
      const qualViewName = `${schema.name}.${extView.name}`
      if (!externalObjectNames.has(qualViewName)) continue
      const fullViewArr = fullViews.get(qualViewName)
      if (!fullViewArr || fullViewArr.length === 0) {
        throw new Error(
          `External object '${extView.name}' was removed by a project or include file. External objects are immutable.`,
        )
      }
      const fullView = fullViewArr[0]

      const extCols = normalizeColumns(extView.columns)
      const fullCols = normalizeColumns(fullView.columns)
      if (extCols !== fullCols) {
        throw new Error(
          `External object '${extView.name}' was modified by a project or include file. External objects are immutable.`,
        )
      }
    }
  }
}

/**
 * Filter external objects from a realm, returning a new realm without them (D-20).
 * Used when config.codegen.skipExternal is true.
 */
export function filterExternalFromRealm(realm: Realm, externalNames: Set<string>): Realm {
  return {
    ...realm,
    schemas: realm.schemas.map((schema) => ({
      ...schema,
      tables: (schema.tables ?? []).filter((t) => !externalNames.has(`${schema.name}.${t.name}`)),
      views: (schema.views ?? []).filter((v) => !externalNames.has(`${schema.name}.${v.name}`)),
    })),
  }
}
