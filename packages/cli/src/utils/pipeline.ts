import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRunner } from '@sqldoc/atlas'
import type { CompilerOutput, NamespacePlugin, ResolvedConfig, SqlStatement } from '@sqldoc/core'
import { compile, loadImports, parse, SqlparserTsAdapter, validate } from '@sqldoc/core'
import pc from 'picocolors'
import { promptAndInstallMissing } from './auto-install.ts'
import { discoverSqlFiles } from './discover.ts'
import { formatDiagnostic } from './format.ts'

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
  atlasRealm?: unknown
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
  _configRoot: string,
): Promise<PipelineResult> {
  // Discover SQL files
  const sqlFiles = await discoverSqlFiles(inputPath, config.include)
  if (sqlFiles.length === 0) {
    console.error(pc.yellow('No SQL files found'))
    return { mergedSql: '', outputs: [], plugins: new Map(), totalErrors: 0 }
  }

  // Initialize AST adapter once
  const adapter = new SqlparserTsAdapter()
  await adapter.init()

  // ── Atlas -- required for compilation ──────────────────────────────
  const dialect = config.dialect ?? 'postgres'
  const allRawContents = sqlFiles.map((f) => fs.readFileSync(f, 'utf-8'))

  // Detect goose migration format and warn once
  if (allRawContents.some((sql) => /^--\s*\+goose\s+(Up|Down)/m.test(sql))) {
    console.error(pc.yellow('Warning: detected goose migration format. Down scripts will be stripped.'))
  }

  const allSqlContents = allRawContents.map(stripMigrationDown)

  // Pass SQL files to createRunner so it can detect CREATE EXTENSION
  // and load the right extensions into pglite (or validate on real postgres)
  const atlasRunner = await createRunner({ dialect, devUrl: config.devUrl, sqlFiles: allSqlContents })

  const mergedOutputs: string[] = []
  const allOutputs: CompilerOutput[] = []
  const allPlugins = new Map<string, NamespacePlugin>()
  let totalErrors = 0
  let atlasRealm: unknown

  try {
    const relFiles = sqlFiles.map((f) => path.relative(process.cwd(), f))
    const inspectResult = await atlasRunner.inspect(allSqlContents, {
      schema: dialect === 'postgres' ? 'public' : undefined,
      dialect,
      fileNames: relFiles,
    })
    if (!inspectResult.schema) {
      throw new Error(inspectResult.error ?? 'Atlas failed to parse schema')
    }
    if (inspectResult.error) {
      console.error(pc.yellow(inspectResult.error))
    }
    atlasRealm = inspectResult.schema

    for (const filePath of sqlFiles) {
      const rel = path.relative(process.cwd(), filePath)
      console.log(pc.cyan(`── ${rel}`))
      const source = fs.readFileSync(filePath, 'utf-8')

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

      // Parse SQL AST
      let statements: SqlStatement[] = []
      try {
        statements = adapter.parseStatements(source)
      } catch {
        // AST parse failure is non-fatal
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
