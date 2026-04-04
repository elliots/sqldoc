import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ResolvedConfig } from '@sqldoc/core'
import { loadConfig, resolveAllProjects, resolveProject } from '@sqldoc/core'
import type { AtlasResult } from '@sqldoc/db'
import { createRunner, extractExtensions, extractScheme } from '@sqldoc/db'
import pc from 'picocolors'
import { resolveConfigRoot } from '../debug.ts'
import { CliError } from '../errors.ts'
import { runCompilePipeline } from '../utils/pipeline.ts'
import { printChanges } from '../utils/pretty-changes.ts'

type Format = 'sql' | 'json' | 'pretty'

// ── Source resolution ────────────────────────────────────────────────

interface ResolvedSource {
  type: 'file' | 'directory' | 'database'
  /** For database: connection URL. For file/directory: merged compiled SQL */
  value: string
  /** Atlas realm from the pipeline (reuse instead of re-inspecting) */
  atlasRealm?: unknown
  /** External SQL to prepend to the other side of a diff (per D-09) */
  externalSql?: string
}

async function resolveSource(source: string, config: ResolvedConfig, configRoot: string): Promise<ResolvedSource> {
  // Any URL with a scheme (foo://...) is treated as a database connection
  const scheme = extractScheme(source)
  if (scheme !== source && source.includes('://')) {
    return { type: 'database', value: source }
  }

  const resolved = path.resolve(source)
  const result = await runCompilePipeline(resolved, config, configRoot)
  if (result.totalErrors > 0) {
    throw new Error(`${result.totalErrors} compilation error(s)`)
  }

  // Collect external SQL for diff cancellation (D-09)
  let externalSql: string | undefined
  if (result.provenanceMap.size > 0) {
    const parts: string[] = []
    for (const [filePath, provenance] of result.provenanceMap) {
      if (provenance === 'external') {
        parts.push(fs.readFileSync(filePath, 'utf-8'))
      }
    }
    if (parts.length > 0) externalSql = parts.join('\n')
  }

  return {
    type: fs.statSync(resolved).isDirectory() ? 'directory' : 'file',
    value: result.mergedSql,
    atlasRealm: result.atlasRealm,
    externalSql,
  }
}

// ── schema inspect ───────────────────────────────────────────────────

export async function schemaInspectCommand(
  source: string | undefined,
  options: { config?: string; format?: string; devUrl?: string; project?: string },
): Promise<void> {
  const configRoot = resolveConfigRoot(options.config)
  const { config: rawConfig } = await loadConfig(configRoot, options.config)
  const projects = options.project ? [resolveProject(rawConfig, options.project)] : resolveAllProjects(rawConfig)

  for (const config of projects) {
    if (options.devUrl) config.devUrl = options.devUrl

    // Resolve source: explicit arg > config.schema > error
    const resolvedSource = source ?? config.schema
    if (!resolvedSource) {
      throw new CliError('No source provided. Specify a path argument or set "schema" in sqldoc.config.ts')
    }
    const dialect = config.dialect
    const format = (options.format ?? 'sql') as Format

    try {
      const resolved = await resolveSource(resolvedSource, config, configRoot)

      if (resolved.type === 'database') {
        // Live database — inspect directly, no compilation needed
        const runner = await createRunner({ dialect, devUrl: resolved.value })
        try {
          const result = await runner.inspect([], {
            schema: dialect === 'postgres' ? 'public' : undefined,
          })
          if (result.error) {
            throw new CliError(`Inspect error: ${result.error}`)
          }
          outputInspect(result, format)
        } finally {
          await runner.close()
        }
      } else if (resolved.atlasRealm) {
        // Pipeline already inspected — reuse the realm
        outputInspect({ schema: resolved.atlasRealm } as AtlasResult, format)
      } else {
        throw new CliError('No schema available')
      }
    } catch (err: any) {
      if (err instanceof CliError) throw err
      throw new CliError(friendlyError(err, config))
    }
  }
}

function outputInspect(result: AtlasResult, format: Format): void {
  if (format === 'json') {
    console.log(JSON.stringify(result.schema, null, 2))
  } else {
    if (result.statements?.length) {
      console.log(`${result.statements.join(';\n')};`)
    } else if (result.schema) {
      console.log(JSON.stringify(result.schema, null, 2))
    }
  }
}

// ── schema diff ──────────────────────────────────────────────────────

export async function schemaDiffCommand(options: {
  config?: string
  from?: string
  to?: string
  format?: string
  devUrl?: string
  check?: boolean
  project?: string
}): Promise<void> {
  const configRoot = resolveConfigRoot(options.config)
  const { config: rawConfig } = await loadConfig(configRoot, options.config)
  const projects = options.project ? [resolveProject(rawConfig, options.project)] : resolveAllProjects(rawConfig)

  for (const config of projects) {
    if (options.devUrl) config.devUrl = options.devUrl
    const dialect = config.dialect
    const format = (options.format ?? 'sql') as Format

    // Default --to to config.schema, --from to config.migrations.dir when both omitted
    let toSource = options.to
    let fromSource = options.from

    if (!toSource && !fromSource && config.schema && config.migrations?.dir) {
      // Smart default: diff migrations -> schema
      fromSource = path.resolve(configRoot, config.migrations.dir)
      toSource = config.schema
    } else {
      toSource = toSource ?? config.schema
    }

    if (!toSource) {
      throw new CliError('--to is required. Usage: sqldoc schema diff --to <source> [--from <source>]')
    }

    try {
      const toResolved = await resolveSource(toSource, config, configRoot)
      const fromResolved = fromSource
        ? await resolveSource(fromSource, config, configRoot)
        : { type: 'file' as const, value: '' } // empty = no existing schema

      if (fromResolved.type === 'database' || toResolved.type === 'database') {
        await diffWithLiveDb(fromResolved, toResolved, config, dialect, format, options.check ?? false)
        return
      }

      let fromSql: string[] = [fromResolved.value]
      let toSql: string[] = [toResolved.value]

      // External cancellation: if "to" has externals, add them to "from" too (D-09)
      if (toResolved.externalSql && fromSql[0]) {
        fromSql = [[toResolved.externalSql, fromSql[0]].join('\n')]
      } else if (toResolved.externalSql) {
        fromSql = [toResolved.externalSql]
      }
      // Vice versa if "from" has externals
      if (fromResolved.externalSql && toSql[0]) {
        toSql = [[fromResolved.externalSql, toSql[0]].join('\n')]
      } else if (fromResolved.externalSql) {
        toSql = [fromResolved.externalSql]
      }

      const allSql = [...fromSql, ...toSql].filter(Boolean)
      const { extensions } = extractExtensions(allSql)
      const runner = await createRunner({ dialect, devUrl: config.devUrl, extensions })
      try {
        const result = await runner.diff(fromSql, toSql, {
          schema: dialect === 'postgres' ? 'public' : undefined,
        })
        outputDiff(result, format, options.check ?? false)
      } finally {
        await runner.close()
      }
    } catch (err: any) {
      if (err instanceof CliError) throw err
      throw new CliError(friendlyError(err, config))
    }
  }
}

async function diffWithLiveDb(
  from: ResolvedSource,
  to: ResolvedSource,
  config: ResolvedConfig,
  dialect: 'postgres' | 'mysql' | 'sqlite',
  format: Format,
  check: boolean,
): Promise<void> {
  const schemaOpt = dialect === 'postgres' ? 'public' : undefined

  const liveSource = from.type === 'database' ? from : to
  const sqlSource = from.type === 'database' ? to : from

  const liveRunner = await createRunner({ dialect, devUrl: liveSource.value })
  let liveRealm
  try {
    const liveResult = await liveRunner.inspect([], { schema: schemaOpt })
    if (liveResult.error) throw new Error(`Live DB inspect: ${liveResult.error}`)
    liveRealm = liveResult.schema
  } finally {
    await liveRunner.close()
  }

  const devRunner = await createRunner({
    dialect,
    devUrl: config.devUrl,
    extensions: extractExtensions([sqlSource.value]).extensions,
  })
  let sqlRealm
  try {
    const sqlResult = await devRunner.inspect([sqlSource.value], { schema: schemaOpt })
    if (sqlResult.error) throw new Error(`SQL inspect: ${sqlResult.error}`)
    sqlRealm = sqlResult.schema
  } finally {
    await devRunner.close()
  }

  const diffSql = [...(from.type !== 'database' ? [from.value] : []), ...(to.type !== 'database' ? [to.value] : [])]
  const diffRunner = await createRunner({
    dialect,
    devUrl: config.devUrl,
    extensions: extractExtensions(diffSql).extensions,
  })
  try {
    const fromSql = from.type === 'database' ? [] : [from.value]
    const toSql = to.type === 'database' ? [] : [to.value]

    if (from.type === 'database' && to.type !== 'database') {
      if (format === 'json') {
        console.log(JSON.stringify({ from: liveRealm, to: sqlRealm }, null, 2))
        return
      } else if (format === 'pretty') {
        prettyCompareRealms(liveRealm, sqlRealm, check)
        return
      }
    }
    const result = await diffRunner.diff(fromSql, toSql, { schema: schemaOpt })
    outputDiff(result, format, check)
  } finally {
    await diffRunner.close()
  }
}

function outputDiff(result: AtlasResult, format: Format, check: boolean): void {
  if (result.error) {
    throw new CliError(`Diff error: ${result.error}`)
  }

  const stmts = result.statements ?? []

  if (stmts.length === 0) {
    if (format === 'pretty' || check) {
      console.error(pc.green('Schemas are identical. No changes detected.'))
    }
    return
  }

  switch (format) {
    case 'sql':
      for (const stmt of stmts) {
        console.log(`${stmt};`)
      }
      break
    case 'json':
      console.log(JSON.stringify({ statements: stmts }, null, 2))
      break
    case 'pretty':
      if (result.changes && result.changes.length > 0) {
        const header = check ? pc.red(pc.bold('Schema drift detected!')) : pc.yellow(pc.bold('Schema differences:'))
        printChanges(result.changes, header)
        console.error(`  ${stmts.length} statement(s)`)
      } else {
        prettyDiff(stmts, check)
      }
      break
  }

  if (check) {
    throw new CliError('Schema drift detected')
  }
}

function prettyDiff(statements: string[], check: boolean): void {
  const header = check ? pc.red(pc.bold('Schema drift detected!')) : pc.yellow(pc.bold('Schema differences:'))
  console.error(header)
  console.error('')

  for (const stmt of statements) {
    const upper = stmt.trimStart().toUpperCase()
    if (upper.startsWith('CREATE')) {
      console.error(pc.green(`  + ${stmt}`))
    } else if (upper.startsWith('DROP')) {
      console.error(pc.red(`  - ${stmt}`))
    } else if (upper.startsWith('ALTER')) {
      if (upper.includes('ADD')) {
        console.error(pc.green(`  ~ ${stmt}`))
      } else if (upper.includes('DROP')) {
        console.error(pc.red(`  ~ ${stmt}`))
      } else {
        console.error(pc.yellow(`  ~ ${stmt}`))
      }
    } else {
      console.error(`  ${stmt}`)
    }
  }

  console.error('')
  console.error(`  ${statements.length} statement(s)`)
}

function prettyCompareRealms(from: any, to: any, check: boolean): void {
  const fromTables = new Set((from?.schemas?.[0]?.tables ?? []).map((t: any) => t.name))
  const toTables = new Set((to?.schemas?.[0]?.tables ?? []).map((t: any) => t.name))

  const stmts: string[] = []
  for (const name of toTables) {
    if (!fromTables.has(name)) stmts.push(`CREATE TABLE ${name} (new)`)
  }
  for (const name of fromTables) {
    if (!toTables.has(name)) stmts.push(`DROP TABLE ${name}`)
  }

  if (stmts.length === 0) {
    console.error(pc.green('Schemas are identical. No changes detected.'))
    return
  }

  prettyDiff(stmts, check)
  if (check) throw new CliError('Schema drift detected')
}

function friendlyError(err: any, config: ResolvedConfig): string {
  if (err?.code === 'ECONNREFUSED') {
    return `Cannot connect to database${config.devUrl ? ` at ${config.devUrl}` : ''}. Is it running?`
  }
  return err?.message ?? String(err)
}
