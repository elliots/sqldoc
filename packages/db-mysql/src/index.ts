import type { AdapterPluginContext, DatabaseAdapter, DatabaseAdapterPlugin, ExecResult, QueryResult } from '@sqldoc/db'
import { normalizeValue } from '@sqldoc/db'

const plugin: DatabaseAdapterPlugin = {
  apiVersion: 1,
  name: 'mysql',
  schemes: ['mysql'],
  dialects: ['mysql'],
  runtime: 'any',

  async createAdapter(connectionString: string, _context: AdapterPluginContext): Promise<DatabaseAdapter> {
    const mysql = await import('mysql2/promise')
    const connection = await mysql.default.createConnection(connectionString)

    // Detect current schema at connection time
    const [schemaRows] = await connection.query({ sql: 'SELECT DATABASE() AS s', rowsAsArray: true })
    const currentSchema = ((schemaRows as unknown[][])[0] as unknown[])[0] as string

    return {
      currentSchema,
      async query(sql: string, args?: unknown[]): Promise<QueryResult> {
        const [rows, fields] = await connection.query({ sql, values: args, rowsAsArray: true })
        return {
          columns: (fields as Array<{ name: string }>).map((f) => f.name),
          rows: (rows as unknown[][]).map((row) => (row as unknown[]).map((v) => normalizeValue(v))),
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
