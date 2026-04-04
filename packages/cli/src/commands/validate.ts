import * as fs from 'node:fs'
import type { Diagnostic, ResolvedConfig, SqlStatement } from '@sqldoc/core'
import {
  loadConfig,
  loadImports,
  parse,
  resolveAllProjects,
  resolveProject,
  SqlparserTsAdapter,
  validate,
} from '@sqldoc/core'
import pc from 'picocolors'
import { resolveConfigRoot } from '../debug.ts'
import { CliError } from '../errors.ts'
import { promptAndInstallMissing } from '../utils/auto-install.ts'
import { discoverSqlFiles } from '../utils/discover.ts'
import { formatDiagnostic, formatSummary } from '../utils/format.ts'

/**
 * validate command: checks tags in SQL files and reports diagnostics
 * with file:line:col format. Exits non-zero when errors are found.
 */
export async function validateCommand(
  inputPath: string | undefined,
  options: { config?: string; project?: string },
): Promise<void> {
  // Load project config
  const configRoot = resolveConfigRoot(options.config)
  const { config: rawConfig } = await loadConfig(configRoot, options.config)
  const projects = options.project ? [resolveProject(rawConfig, options.project)] : resolveAllProjects(rawConfig)

  for (const config of projects) {
    await validateProject(inputPath, config, configRoot)
  }
}

async function validateProject(
  inputPath: string | undefined,
  config: ResolvedConfig,
  _configRoot: string,
): Promise<void> {
  // Resolve input path: explicit arg > config.schema > error
  const resolvedInput = inputPath ?? config.schema
  if (!resolvedInput) {
    throw new CliError('No input path provided. Specify a path argument or set "schema" in sqldoc.config.ts')
  }

  // Discover SQL files
  const sqlFiles = await discoverSqlFiles(resolvedInput, config.include)
  if (sqlFiles.length === 0) {
    console.log(pc.yellow('No SQL files found'))
    return
  }

  let totalErrors = 0
  let totalWarnings = 0

  for (const filePath of sqlFiles) {
    const source = fs.readFileSync(filePath, 'utf-8')

    // Parse tags and imports
    const { imports, tags } = parse(source)

    // Load namespace definitions (with auto-install for missing packages)
    let { namespaces, errors: loadErrors } = await loadImports(
      imports.map((i) => i.path),
      filePath,
    )

    if (loadErrors.length > 0) {
      const retryResult = await promptAndInstallMissing(
        loadErrors,
        imports.map((i) => i.path),
        filePath,
      )
      if (retryResult) {
        namespaces = retryResult.namespaces
        loadErrors = retryResult.errors
      }

      if (loadErrors.length > 0) {
        for (const err of loadErrors) {
          console.log(pc.red(`Error loading ${err.importPath}: ${err.message}`))
        }
        totalErrors += loadErrors.length
      }
    }

    // Parse SQL AST for enriched validation
    let statements: SqlStatement[] = []
    try {
      const adapter = new SqlparserTsAdapter(config.dialect)
      await adapter.init()
      statements = adapter.parseStatements(source)
    } catch {
      // AST parse failure is non-fatal
    }

    // Validate: signature is validate(tags, namespaces, docText, stmts?)
    const diagnostics: Diagnostic[] = validate(tags, namespaces, source, statements)

    // Format and print diagnostics
    for (const d of diagnostics) {
      console.log(formatDiagnostic(filePath, d))
      if (d.severity === 'error') totalErrors++
      else totalWarnings++
    }
  }

  // Print summary
  console.log(formatSummary(totalErrors, totalWarnings))

  if (totalErrors > 0) {
    throw new CliError(`${totalErrors} validation error(s)`)
  }
}
