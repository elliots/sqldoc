import type { AdapterPluginContext, DatabaseAdapter, DatabaseAdapterPlugin, ExecResult, QueryResult } from '@sqldoc/db'
import { normalizeValue } from '@sqldoc/db'
import postgres from 'postgres'

const plugin: DatabaseAdapterPlugin = {
  apiVersion: 1,
  name: 'postgres',
  schemes: ['postgres', 'postgresql'],
  dialects: ['postgres'],
  runtime: 'node',

  async createAdapter(connectionString: string, _context: AdapterPluginContext): Promise<DatabaseAdapter> {
    const sql = postgres(connectionString, { connect_timeout: 5, onnotice: () => {} })

    // Verify the connection works — postgres.js connects lazily
    try {
      await sql`SELECT 1`
    } catch (err) {
      await sql.end()
      throw err
    }

    return {
      async query(queryText: string, args?: unknown[]): Promise<QueryResult> {
        const result = await sql.unsafe(queryText, args as any[], { prepare: false }).values()
        if (result.length === 0) {
          return { columns: [], rows: [] }
        }
        const colCount = (result[0] as unknown[]).length
        const columns = result.columns?.map((c: any) => c.name) ?? Array.from({ length: colCount }, (_, i) => `col${i}`)
        return {
          columns,
          rows: (result as unknown[][]).map((row) => row.map((v) => normalizeValue(v))),
        }
      },
      async exec(queryText: string): Promise<ExecResult> {
        const result = await sql.unsafe(queryText, [], { prepare: false })
        return { rowsAffected: result.count }
      },
      async close(): Promise<void> {
        await sql.end()
      },
    }
  },
}

export default plugin
