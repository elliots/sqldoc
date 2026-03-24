import { Client } from 'pg'
import type { DatabaseAdapter, ExecResult, QueryResult } from './types.ts'

/**
 * Normalize row values to types the Go database/sql driver can scan.
 * The WASI JSON protocol expects strings, numbers, booleans, and null.
 */
function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null
  if (typeof val === 'bigint') return val.toString()
  if (val instanceof Date) return val.toISOString()
  if (Buffer.isBuffer(val)) return val.toString('hex')
  if (typeof val === 'object') {
    return JSON.stringify(val, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  }
  return val
}

/**
 * Create a postgres-based DatabaseAdapter using the pg library.
 * Connects to an external Postgres instance via connection string.
 */
export async function createPostgresAdapter(connectionString: string): Promise<DatabaseAdapter> {
  const client = new Client({ connectionString })
  await client.connect()
  return {
    async query(sql: string, args?: unknown[]): Promise<QueryResult> {
      // Use rowMode: 'array' to get positional values, not name-keyed objects.
      // This handles duplicate column names (e.g. multiple current_setting() calls).
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
}
