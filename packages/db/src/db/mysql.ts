/**
 * MySQL DatabaseAdapter using mysql2/promise.
 * Single connection (no pooling) -- sufficient for schema inspection.
 */
import mysql from 'mysql2/promise'
import type { DatabaseAdapter, ExecResult, QueryResult } from './types.ts'

/**
 * Normalize row values to types the Go database/sql driver can scan.
 * mysql2 returns Date objects for datetime, Buffer for binary, BigInt for BIGINT.
 */
function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null
  if (typeof val === 'bigint') return val.toString()
  if (val instanceof Date) return val.toISOString()
  if (Buffer.isBuffer(val)) return val.toString('hex')
  if (typeof val === 'object') return JSON.stringify(val)
  return val
}

/**
 * Create a MySQL DatabaseAdapter connected to an existing MySQL instance.
 * Uses mysql2/promise for async connection management.
 */
export async function createMysqlAdapter(connectionString: string): Promise<DatabaseAdapter> {
  const connection = await mysql.createConnection(connectionString)

  return {
    async query(sql: string, args?: unknown[]): Promise<QueryResult> {
      const [rows, fields] = await connection.query({ sql, values: args, rowsAsArray: true })
      return {
        columns: (fields as mysql.FieldPacket[]).map((f) => f.name),
        rows: (rows as unknown[][]).map((row) => (row as unknown[]).map(normalizeValue)),
      }
    },
    async exec(sql: string, args?: unknown[]): Promise<ExecResult> {
      const [result] = await connection.query(sql, args as any)
      return { rowsAffected: (result as mysql.ResultSetHeader).affectedRows ?? 0 }
    },
    async close(): Promise<void> {
      await connection.end()
    },
  }
}
