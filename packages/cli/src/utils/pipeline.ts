import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  CompilerOutput,
  FileProvenance,
  NamespacePlugin,
  Realm,
  ResolvedConfig,
  Schema,
  SqlStatement,
} from '@sqldoc/core'
import {
  compile,
  createAstAdapter,
  debug,
  defaultSchemaForEngine,
  findSqldocDir,
  loadImports,
  parse,
  resolveDirectives,
  validate,
} from '@sqldoc/core'
import { createRunner, extractExtensions } from '@sqldoc/db'
import pc from 'picocolors'
import { installPackages, promptAndInstallMissing, promptInstall } from './auto-install.ts'
import {
  computeCompileCacheKey,
  computeRealmCacheKey,
  getCacheDir,
  readCompileCache,
  readRealmCache,
  writeCompileCache,
  writeRealmCache,
} from './cache.ts'
import { discoverSqlFiles } from './discover.ts'
import { formatDiagnostic } from './format.ts'
import { buildPipelineInputs } from './pipeline-inputs.ts'

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
  /** Schema realm from initial inspect (pre-compile schema) */
  schemaRealm?: Realm
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
/** Options that affect pipeline behavior without changing compile semantics. */
export interface PipelineRunOptions {
  /** Skip all caching (read and write) regardless of SQLDOC_NO_CACHE env. */
  noCache?: boolean
  /** Suppress per-file progress logs (e.g. `── path/to/schema.sql`).
   *  Intended for programmatic callers that don't want stderr chatter. */
  quiet?: boolean
}

export async function runCompilePipeline(
  inputPath: string,
  config: ResolvedConfig,
  configRoot: string,
  options: PipelineRunOptions = {},
): Promise<PipelineResult> {
  debug('pipeline', `runCompilePipeline: input=${inputPath}, engine=${config.engine}, dialect=${config.dialect}`)
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
  const adapter = createAstAdapter(config.dialect)
  await adapter.init()

  // ── Resolve @external and @include directives ──────────────────────
  const resolved = await resolveDirectives(sqlFiles, (f) => fs.readFileSync(f, 'utf-8'))
  const hasExternals = resolved.externalFiles.length > 0
  debug('pipeline', `directives: ${resolved.externalFiles.length} external, ${resolved.includeFiles.length} include`)

  // For schema inspection and compilation: external files first, then project
  // files, then resolved includes. Include files are first-class inputs so shared
  // includes are inspected and compiled once instead of appended to every file.
  const { mergedProjectContents, allFiles, allRawContents } = buildPipelineInputs(sqlFiles, resolved)

  // Detect goose migration format and warn once
  if (allRawContents.some((sql) => /^--\s*\+goose\s+(Up|Down)/m.test(sql))) {
    console.error(pc.yellow('Warning: detected goose migration format. Down scripts will be stripped.'))
  }

  const allSqlContents = allRawContents.map(stripMigrationDown)

  const { extensions } = extractExtensions(allSqlContents)
  const sqldocDir = findSqldocDir(configRoot) ?? undefined
  const cacheDir = options.noCache ? undefined : getCacheDir(sqldocDir)

  // ── Realm cache keys ──────────────────────────────────────────────
  // Realm inspection depends on the full set of SQL file contents plus engine/dialect/extensions.
  // Byte-identical inputs produce byte-identical realms, so we can skip the DB round-trip entirely.
  const relAllFiles = allFiles.map((f) => path.relative(configRoot, f))
  const fullRealmKey = computeRealmCacheKey({
    tag: 'full',
    engine: config.engine,
    dialect: config.dialect,
    extensions,
    files: allFiles.map((_, i) => ({ relPath: relAllFiles[i], content: allSqlContents[i] })),
  })

  let externalRealmKey: string | undefined
  let externalContents: string[] | undefined
  if (hasExternals) {
    externalContents = resolved.externalFiles.map((f) => stripMigrationDown(fs.readFileSync(f, 'utf-8')))
    externalRealmKey = computeRealmCacheKey({
      tag: 'external',
      engine: config.engine,
      dialect: config.dialect,
      extensions,
      schema: defaultSchemaForEngine(config.engine),
      files: resolved.externalFiles.map((f, i) => ({
        relPath: path.relative(configRoot, f),
        content: externalContents![i],
      })),
    })
  }

  // ── Try realm caches first, create runner only if inspection is needed ──
  let schemaRealm = readRealmCache(cacheDir, fullRealmKey)
  let externalRealm: Realm | undefined
  if (hasExternals && externalRealmKey) {
    externalRealm = readRealmCache(cacheDir, externalRealmKey)
  }
  const needsInspect = !schemaRealm || (hasExternals && !externalRealm)
  if (!needsInspect) debug('pipeline', 'realm cache hit — skipping DB inspection')

  const runner = needsInspect
    ? await createRunner({
        engine: config.engine,
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
    : undefined

  const mergedOutputs: string[] = []
  const allOutputs: CompilerOutput[] = []
  const allPlugins = new Map<string, NamespacePlugin>()
  let totalErrors = 0
  const externalObjectNames = new Set<string>()

  try {
    // ── Dual schema inspection when @external directives present (D-16, D-17) ──
    if (hasExternals && !externalRealm) {
      if (!runner) throw new Error('runner unexpectedly missing while inspecting external realm')
      const externalResult = await runner.inspect(externalContents!, {
        schema: defaultSchemaForEngine(config.engine),
      })
      if (!externalResult.schema) {
        throw new Error(externalResult.error ?? 'Schema inspection failed to parse external schema')
      }
      externalRealm = externalResult.schema
      writeRealmCache(cacheDir, externalRealmKey!, externalRealm)
    }

    if (externalRealm) {
      // Extract external object names (schema-qualified to avoid cross-schema collisions)
      for (const schema of externalRealm.schemas) {
        for (const table of schema.tables ?? []) externalObjectNames.add(`${schema.name}.${table.name}`)
        for (const view of schema.views ?? []) externalObjectNames.add(`${schema.name}.${view.name}`)
      }
    }

    // Inspection 2 (or sole inspection when no externals): all files -> fullRealm
    // Use zero-padded index prefix so inspection preserves dependency order when it sorts by filename
    if (!schemaRealm) {
      if (!runner) throw new Error('runner unexpectedly missing while inspecting full realm')
      const relFiles = allFiles.map((f, i) => `${String(i).padStart(4, '0')}_${path.relative(process.cwd(), f)}`)
      const inspectResult = await runner.inspect(allSqlContents, {
        fileNames: relFiles,
      })
      if (!inspectResult.schema) {
        throw new Error(inspectResult.error ?? 'Schema inspection failed to parse schema')
      }
      if (inspectResult.error) {
        console.error(pc.yellow(inspectResult.error))
      }
      schemaRealm = inspectResult.schema
      debug('pipeline', 'schema inspect complete')
      writeRealmCache(cacheDir, fullRealmKey, schemaRealm)
    }

    // Validate external object immutability (D-18)
    if (hasExternals && externalRealm && schemaRealm) {
      validateExternalImmutability(externalRealm, schemaRealm, externalObjectNames)
    }

    for (const filePath of allFiles) {
      const rel = path.relative(process.cwd(), filePath)
      if (!options.quiet) console.error(pc.cyan(`── ${rel}`))
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

      // ── Per-file compile cache lookup ────────────────────────────
      const compileKey = computeCompileCacheKey({
        filePath,
        source,
        importPaths: imports.map((i) => i.path),
        config,
        realmKey: fullRealmKey,
        sqldocDir,
      })
      let output = readCompileCache(cacheDir, compileKey)

      if (!output) {
        // Parse SQL AST (supplementary — schema inspection is the real schema source)
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

        // Abort this file if validation errors found — do not cache partial results
        if (diagnostics.some((d) => d.severity === 'error')) {
          continue
        }

        // Compile with inspected schema
        output = compile({ source, filePath, plugins, statements, adapter, config, schemaRealm })
        writeCompileCache(cacheDir, compileKey, output)
      }

      // Set provenance on each CompilerOutput (not cached — derived from current run)
      output.provenance = resolved.provenanceMap.get(filePath) ?? 'project'

      mergedOutputs.push(output.mergedSql)
      allOutputs.push(output)
      for (const [name, plugin] of plugins) {
        if (!allPlugins.has(name)) allPlugins.set(name, plugin)
      }

      if (output.errors.length > 0) {
        for (const err of output.errors) {
          const color = err.severity === 'info' ? pc.dim : pc.red
          console.error(color(`[${err.namespace}] ${err.message}`))
          if (err.severity !== 'info') totalErrors++
        }
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
    if (runner) await runner.close()
  }

  return {
    mergedSql: mergedOutputs.join('\n'),
    outputs: allOutputs,
    plugins: allPlugins,
    totalErrors,
    schemaRealm,
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
 * Normalize an inspected object (table or view) to a canonical string for comparison.
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
