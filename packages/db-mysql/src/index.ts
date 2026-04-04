import type { DatabaseAdapter, DatabaseAdapterPlugin, ExecResult, QueryResult } from '@sqldoc/db'
import { normalizeValue } from '@sqldoc/db'

const plugin: DatabaseAdapterPlugin = {
  apiVersion: 1,
  name: 'mysql',
  schemes: ['mysql'],
  dialects: ['mysql'],
  runtime: 'node',

  async createAdapter(connectionString: string): Promise<DatabaseAdapter> {
    const mysql = await import('mysql2/promise')
    const connection = await mysql.default.createConnection(connectionString)

    return {
      async query(sql: string, args?: unknown[]): Promise<QueryResult> {
        const [rows, fields] = await connection.query({ sql, values: args, rowsAsArray: true })
        return {
          columns: (fields as Array<{ name: string }>).map((f) => f.name),
          rows: (rows as unknown[][]).map((row) => (row as unknown[]).map(normalizeValue)),
        }
      },
      async exec(sql: string, args?: unknown[]): Promise<ExecResult> {
        const [result] = await connection.query(sql, args as any)
        return { rowsAffected: (result as any).affectedRows ?? 0 }
      },
      async close(): Promise<void> {
        await connection.end()
      },
    }
  },
}

export default plugin
