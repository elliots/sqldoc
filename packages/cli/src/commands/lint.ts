import * as path from 'node:path'
import type { LintResult, ResolvedConfig } from '@sqldoc/core'
import { lint, loadConfig, resolveAllProjects, resolveProject } from '@sqldoc/core'
import pc from 'picocolors'
import { resolveConfigRoot } from '../debug.ts'
import { CliError, formatPipelineError } from '../errors.ts'
import { runCompilePipeline } from '../utils/pipeline.ts'

/**
 * lint command: runs lint rules from loaded namespace plugins against
 * compiled SQL files and reports results with colors.
 */
export async function lintCommand(
  inputPath: string | undefined,
  options: { config?: string; verbose?: boolean; project?: string; cache?: boolean },
): Promise<void> {
  const configRoot = resolveConfigRoot(options.config)
  const { config: rawConfig } = await loadConfig(configRoot, options.config)
  const projects = options.project ? [resolveProject(rawConfig, options.project)] : resolveAllProjects(rawConfig)
  const noCache = options.cache === false

  for (const config of projects) {
    await lintProject(inputPath, config, configRoot, options.verbose, noCache)
  }
}

async function lintProject(
  inputPath: string | undefined,
  config: ResolvedConfig,
  configRoot: string,
  verbose?: boolean,
  noCache?: boolean,
): Promise<void> {
  // Resolve input path: explicit arg > config.schema > error
  const resolvedInput = inputPath ?? config.schema
  if (!resolvedInput) {
    throw new CliError('No input path provided. Specify a path argument or set "schema" in sqldoc.config.ts')
  }

  let result
  try {
    result = await runCompilePipeline(resolvedInput, config, configRoot, { noCache })
  } catch (err: any) {
    throw formatPipelineError(err, config)
  }

  const { outputs, plugins, totalErrors, schemaRealm } = result

  if (totalErrors > 0) {
    throw new CliError(`${totalErrors} compilation error(s) — fix before linting`)
  }

  // Run the lint engine
  const results = lint(outputs, plugins, config, schemaRealm)

  if (results.length === 0) {
    console.log(pc.green('No lint issues found'))
    return
  }

  // Format and print results
  let errorCount = 0
  let warnCount = 0
  let skipCount = 0

  for (const r of results) {
    if (r.severity === 'skip') {
      skipCount++
      if (verbose) console.log(formatLintResult(r))
    } else {
      console.log(formatLintResult(r))
      if (r.severity === 'error') errorCount++
      else if (r.severity === 'warn') warnCount++
    }
  }

  // Summary line
  console.log('')
  const parts: string[] = []
  if (errorCount > 0) parts.push(pc.red(`${errorCount} error(s)`))
  if (warnCount > 0) parts.push(pc.yellow(`${warnCount} warning(s)`))
  if (skipCount > 0) parts.push(pc.dim(`${skipCount} ignored`))
  console.log(parts.join(', '))

  if (errorCount > 0) {
    throw new CliError(`${errorCount} lint error(s)`)
  }
}

/** Format a single lint result for terminal display */
function formatLintResult(r: LintResult): string {
  const file = path.relative(process.cwd(), r.sourceFile)
  const severity = formatSeverity(r.severity)
  const rule = pc.dim(r.ruleName)

  if (r.severity === 'skip') {
    return `${file} ${severity} ${rule.padEnd(35)} ${r.message} ${pc.dim(`(${r.ignoreReason})`)}`
  }

  return `${file} ${severity} ${rule.padEnd(35)} ${r.message}`
}

function formatSeverity(severity: LintResult['severity']): string {
  switch (severity) {
    case 'error':
      return pc.red('error')
    case 'warn':
      return pc.yellow('warn ')
    case 'skip':
      return pc.dim('skip ')
    default:
      return severity
  }
}
