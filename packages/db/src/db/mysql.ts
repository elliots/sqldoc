/**
 * MySQL DatabaseAdapter with runtime detection.
 * Uses bun:sql (built-in) when running in Bun, mysql2 npm package when running in Node.
 */
import type { DatabaseAdapter, ExecResult, QueryResult } from './types.ts'
import { createBunSqlAdapter, isBun, normalizeValue } from './types.ts'

async function createNodeMysqlAdapter(connectionString: string): Promise<DatabaseAdapter> {
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
}

export async function createMysqlAdapter(connectionString: string): Promise<DatabaseAdapter> {
  if (isBun) return createBunSqlAdapter(connectionString)
  return createNodeMysqlAdapter(connectionString)
}
