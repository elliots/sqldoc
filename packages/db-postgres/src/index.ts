import type { DatabaseAdapter, DatabaseAdapterPlugin, ExecResult, QueryResult } from '@sqldoc/db'
import { normalizeValue } from '@sqldoc/db'

const plugin: DatabaseAdapterPlugin = {
  apiVersion: 1,
  name: 'postgres',
  schemes: ['postgres', 'postgresql'],
  dialects: ['postgres'],
  runtime: 'node',

  async createAdapter(connectionString: string): Promise<DatabaseAdapter> {
    const { Client } = await import('pg')
    const client = new Client({ connectionString })
    await client.connect()

    return {
      async query(sql: string, args?: unknown[]): Promise<QueryResult> {
        const result = await client.query({ text: sql, values: args, rowMode: 'array' })
        return {
          columns: result.fields.map((f: { name: string }) => f.name),
          rows: (result.rows as unknown[][]).map((row) => row.map(normalizeValue)),
        }
      },
      async exec(sql: string): Promise<ExecResult> {
        const result = await client.query(sql)
        return { rowsAffected: result.rowCount ?? 0 }
      },
      async close(): Promise<void> {
        await client.end()
      },
    }
  },
}

export default plugin
