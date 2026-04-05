import { PGlite } from '@electric-sql/pglite'
import type { AdapterPluginContext, DatabaseAdapter, DatabaseAdapterPlugin, ExecResult, QueryResult } from '@sqldoc/db'
import { normalizeValue } from '@sqldoc/db'

async function loadExtension(name: string): Promise<any | null> {
  try {
    const mod = await import(`@electric-sql/pglite/contrib/${name}`)
    return mod.default ?? mod[name] ?? mod
  } catch {}
  try {
    const mod = await import(`@electric-sql/pglite/${name}`)
    return mod.default ?? mod[name] ?? mod
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
      if (mod) extModules[ext] = mod
    }

    const db = await PGlite.create({
      extensions: Object.keys(extModules).length > 0 ? extModules : undefined,
    })

    return {
      async query(sql: string, args?: unknown[]): Promise<QueryResult> {
        const result = await db.query(sql, args, { rowMode: 'array' })
        return {
          columns: result.fields.map((f: { name: string }) => f.name),
          rows: (result.rows as unknown[][]).map((row) => row.map((v) => normalizeValue(v))),
        }
      },
      async exec(sql: string): Promise<ExecResult> {
        const result = await db.exec(sql)
        const last = result[result.length - 1]
        return { rowsAffected: last?.affectedRows ?? 0 }
      },
      async close(): Promise<void> {
        await db.close()
      },
    }
  },
}

export default plugin
