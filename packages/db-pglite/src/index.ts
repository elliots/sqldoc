import { PGlite } from '@electric-sql/pglite'
import type { AdapterPluginContext, DatabaseAdapter, DatabaseAdapterPlugin, ExecResult, QueryResult } from '@sqldoc/db'
import { normalizeValue } from '@sqldoc/db'

async function loadExtension(name: string): Promise<any | null> {
  // PGlite module names use underscores (e.g. uuid_ossp) while SQL uses hyphens (uuid-ossp)
  const moduleName = name.replace(/-/g, '_')
  try {
    const mod = await import(`@electric-sql/pglite/contrib/${moduleName}`)
    return mod.default ?? mod[moduleName] ?? mod
  } catch {}
  try {
    const mod = await import(`@electric-sql/pglite/${moduleName}`)
    return mod.default ?? mod[moduleName] ?? mod
  } catch {}
  return null
}

const plugin: DatabaseAdapterPlugin = {
  apiVersion: 1,
  name: 'pglite',
  schemes: ['pglite'],
  dialects: ['postgres'],
  runtime: 'any',

  async createAdapter(_devUrl: string, context: AdapterPluginContext): Promise<DatabaseAdapter> {
    const extModules: Record<string, any> = {}
    for (const ext of context.extensions) {
      const mod = await loadExtension(ext)
      if (mod) extModules[ext.replace(/-/g, '_')] = mod
    }
    const extOpts = Object.keys(extModules).length > 0 ? extModules : undefined

    let db = await PGlite.create({ extensions: extOpts })

    return {
      async query(sql: string, args?: unknown[]): Promise<QueryResult> {
        const result = await db.query(sql, args, { rowMode: 'array' })
        return {
          columns: result.fields.map((f: { name: string }) => f.name),
          rows: (result.rows as unknown[][]).map((row) => row.map((v) => normalizeValue(v))),
        }
      },
      async exec(sql: string, args?: unknown[]): Promise<ExecResult> {
        if (args && args.length > 0) {
          const result = await db.query(sql, args)
          return { rowsAffected: result.affectedRows ?? 0 }
        }
        const result = await db.exec(sql)
        const last = result[result.length - 1]
        return { rowsAffected: last?.affectedRows ?? 0 }
      },
      async close(): Promise<void> {
        await db.close()
      },
      async reset(): Promise<void> {
        await db.close()
        db = await PGlite.create({ extensions: extOpts })
      },
    }
  },
}

export default plugin
