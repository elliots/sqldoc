/**
 * PostgreSQL DatabaseAdapter with runtime detection.
 * Uses bun:sql (built-in) when running in Bun, pg npm package when running in Node.
 */
import type { DatabaseAdapter, ExecResult, QueryResult } from './types.ts'
import { createBunSqlAdapter, isBun, normalizeValue } from './types.ts'

async function createNodePostgresAdapter(connectionString: string): Promise<DatabaseAdapter> {
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
}

export async function createPostgresAdapter(connectionString: string): Promise<DatabaseAdapter> {
  if (isBun) return createBunSqlAdapter(connectionString)
  return createNodePostgresAdapter(connectionString)
}
