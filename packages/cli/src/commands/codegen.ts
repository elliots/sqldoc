import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DocsMeta, ProjectContext, ResolvedConfig } from '@sqldoc/core'
import { loadConfig, resolveProject } from '@sqldoc/core'
import { createRunner, extractExtensions } from '@sqldoc/db'
import type { AtlasRealm } from '@sqldoc/db'
import pc from 'picocolors'
import { CliError, formatPipelineError } from '../errors.ts'
import { generateConfigTypes } from '../utils/generate-config-types.ts'
import { filterExternalFromRealm, runCompilePipeline } from '../utils/pipeline.ts'

/**
 * compile command: reads SQL files, runs the full pipeline
 * (parse, load namespaces, AST, compile), runs afterCompile hooks,
 * THEN outputs merged SQL.
 */
export async function codegenCommand(
  inputPath: string | undefined,
  options: { config?: string; plugins?: string; project?: string },
): Promise<void> {
  const configRoot = options.config
    ? path.dirname(path.resolve(options.config))
    : process.env.SQLDOC_PROJECT_ROOT || process.cwd()
  const { config: rawConfig, configPath } = await loadConfig(configRoot, options.config)
  const config: ResolvedConfig = resolveProject(rawConfig, options.project)

  // Resolve input path: explicit arg > config.schema > error
  const resolvedInput = inputPath ?? config.schema
  if (!resolvedInput) {
    throw new CliError('No input path provided. Specify a path argument or set "schema" in sqldoc.config.ts')
  }

  // Regenerate .sqldoc/config.d.ts for typed config
  const sqldocDir = path.join(configRoot, '.sqldoc')
  if (fs.existsSync(sqldocDir)) {
    generateConfigTypes(sqldocDir)
  }

  const pluginFilter = options.plugins ? new Set(options.plugins.split(',').map((s) => s.trim())) : null

  let result
  try {
    result = await runCompilePipeline(resolvedInput, config, configRoot)
  } catch (err: any) {
    throw formatPipelineError(err, config)
  }

  const { mergedSql, outputs, plugins, totalErrors } = result

  // Run afterCompile hooks BEFORE outputting SQL
  const projectPlugins = [...plugins.entries()].filter(
    ([name, p]) =>
      (typeof p.afterCompile === 'function' || typeof p.generateProject === 'function') &&
      (pluginFilter === null || pluginFilter.has(name)),
  )

  if (projectPlugins.length > 0) {
    const dialect = config.dialect
    const allFileTags = outputs.map((o) => ({
      sourceFile: o.sourceFile,
      objects: o.fileTags.map((ft) => ({
        objectName: ft.objectName,
        target: ft.target,
        tags: ft.tags,
      })),
    }))
    const allDocsMeta: DocsMeta[] = outputs.flatMap((o) => o.docsMeta)

    // Check if plugins generated any additional SQL
    const hasGeneratedSql = outputs.some((o) => o.sqlOutputs.length > 0)
    let postCompileRealm = result.atlasRealm

    if (hasGeneratedSql) {
      // Re-inspect with the merged SQL (includes generated tables like audit_log)
      const freshRunner = await createRunner({
        dialect,
        devUrl: config.devUrl,
        extensions: extractExtensions([mergedSql]).extensions,
      })
      const postCompileResult = await freshRunner.inspect([mergedSql], {
        schema: dialect === 'postgres' ? 'public' : undefined,
      })
      await freshRunner.close()

      if (postCompileResult.error) {
        throw new CliError(`Post-compile schema inspect failed: ${postCompileResult.error}`)
      }
      if (postCompileResult.schema) {
        postCompileRealm = postCompileResult.schema
      }
    }

    // Apply skipExternal filtering if configured (D-20)
    let codegenRealm = postCompileRealm
    if (config.codegen?.skipExternal && result.externalObjectNames.size > 0 && codegenRealm) {
      codegenRealm = filterExternalFromRealm(codegenRealm as AtlasRealm, result.externalObjectNames)
    }

    for (const [nsName, plugin] of projectPlugins) {
      const hook = plugin.afterCompile ?? plugin.generateProject
      const ctx: ProjectContext = {
        dialect: config.dialect,
        outputs,
        mergedSql,
        allFileTags,
        docsMeta: allDocsMeta,
        config: (config.namespaces?.[nsName] ?? {}) as Record<string, unknown>,
        projectRoot: configRoot,
        atlasRealm: codegenRealm,
        externalObjectNames: result.externalObjectNames,
      }

      try {
        const result = await hook!(ctx)
        if (result?.files) {
          for (const file of result.files) {
            const outPath = path.resolve(configRoot, file.filePath)
            try {
              fs.mkdirSync(path.dirname(outPath), { recursive: true })
              fs.writeFileSync(outPath, file.content, 'utf-8')
            } catch (writeErr: any) {
              throw new CliError(`Failed to write ${outPath}: ${writeErr?.message ?? writeErr}`)
            }
            const label = (file as any).source ? `${nsName}/${(file as any).source}` : nsName
            console.error(pc.green(`[${label}] wrote ${path.relative(process.cwd(), outPath)}`))
          }
        }
      } catch (err: any) {
        if (err instanceof CliError) throw err
        if (configPath) {
          console.error(pc.dim(`config: ${configPath}`))
        }
        throw new CliError(`[${nsName}] ${err?.message ?? err}`)
      }
    }
  }

  if (totalErrors > 0) {
    throw new CliError(`${totalErrors} error(s) encountered`)
  }
}
