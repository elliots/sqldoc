import type { AdapterPluginContext, DatabaseAdapter, DatabaseAdapterPlugin, ExecResult, QueryResult } from '@sqldoc/db'
import { normalizeValue } from '@sqldoc/db'

async function closeConnection(connection: { end(): Promise<void>; destroy(): void }): Promise<void> {
  try {
    await connection.end()
  } catch {
    connection.destroy()
  }
}

const plugin: DatabaseAdapterPlugin = {
  apiVersion: 1,
  name: 'mysql',
  schemes: ['mysql'],
  dialects: ['mysql'],
  runtime: 'any',

  async createAdapter(connectionString: string, _context: AdapterPluginContext): Promise<DatabaseAdapter> {
    const mysql = await import('mysql2/promise')
    const connection = await mysql.default.createConnection(connectionString)

    let currentSchema: string
    try {
      const [schemaRows] = await connection.query({ sql: 'SELECT DATABASE() AS s', rowsAsArray: true })
      const schemaValue = (schemaRows as unknown[][])[0]?.[0]
      if (typeof schemaValue !== 'string' || schemaValue.length === 0) {
        throw new Error('mysql: SELECT DATABASE() returned no current schema')
      }
      currentSchema = schemaValue
    } catch (err) {
      await closeConnection(connection)
      throw err
    }

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
