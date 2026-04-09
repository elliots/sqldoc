import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadConfig, resolveAllProjects, resolveProject } from '@sqldoc/core'
import { resolveConfigRoot } from '../debug.ts'
import { CliError, formatPipelineError } from '../errors.ts'
import { runCompilePipeline } from '../utils/pipeline.ts'

/**
 * compile command: reads SQL files, runs the full pipeline, outputs merged SQL to stdout or file.
 *
 * By default, external files are excluded from the output (they're compiled for validation
 * but filtered from the result). Pass --include-externals to include them.
 */
export async function compileCommand(
  inputPath: string | undefined,
  options: { config?: string; output?: string; project?: string; includeExternals?: boolean },
): Promise<void> {
  const configRoot = resolveConfigRoot(options.config)
  const { config: rawConfig } = await loadConfig(configRoot, options.config)
  const projects = options.project ? [resolveProject(rawConfig, options.project)] : resolveAllProjects(rawConfig)

  for (const config of projects) {
    const resolvedInput = inputPath ?? config.schema
    if (!resolvedInput) {
      throw new CliError('No input path provided. Specify a path argument or set "schema" in sqldoc.config.ts')
    }

    let result
    try {
      result = await runCompilePipeline(resolvedInput, config, configRoot)
    } catch (err: any) {
      throw formatPipelineError(err, config)
    }

    // Filter out external file outputs unless --include-externals is set
    const outputSql = options.includeExternals
      ? result.mergedSql
      : result.outputs
          .filter((o) => o.provenance !== 'external')
          .map((o) => o.mergedSql)
          .join('\n')

    if (options.output) {
      const outPath = path.resolve(configRoot, options.output)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, outputSql, 'utf-8')
    } else {
      process.stdout.write(outputSql)
    }
  }
}
