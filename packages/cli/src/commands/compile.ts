import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ResolvedConfig } from '@sqldoc/core'
import { loadConfig, resolveProject } from '@sqldoc/core'
import { resolveConfigRoot } from '../debug.ts'
import { CliError, formatPipelineError } from '../errors.ts'
import { runCompilePipeline } from '../utils/pipeline.ts'

/**
 * compile command: reads SQL files, runs the full pipeline, outputs merged SQL to stdout or file.
 */
export async function compileCommand(
  inputPath: string | undefined,
  options: { config?: string; output?: string; project?: string },
): Promise<void> {
  const configRoot = resolveConfigRoot(options.config)
  const { config: rawConfig } = await loadConfig(configRoot, options.config)
  const config: ResolvedConfig = resolveProject(rawConfig, options.project)

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

  if (options.output) {
    const outPath = path.resolve(configRoot, options.output)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, result.mergedSql, 'utf-8')
  } else {
    process.stdout.write(result.mergedSql)
  }
}
