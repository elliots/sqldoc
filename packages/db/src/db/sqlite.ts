/**
 * SQLite DatabaseAdapter with runtime detection.
 * Uses bun:sqlite when running in Bun, node:sqlite when running in Node.
 * Both are synchronous APIs wrapped in async methods to match the DatabaseAdapter interface.
 */
import type { SQLInputValue } from 'node:sqlite'
import type { DatabaseAdapter, ExecResult, QueryResult } from './types.ts'

/**
 * Normalize row values to types the Go database/sql driver can scan.
 * SQLite returns integers for booleans, stores dates as strings or numbers.
 */
function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null
  if (typeof val === 'bigint') return val.toString()
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) return Buffer.from(val).toString('hex')
  if (typeof val === 'object') return JSON.stringify(val)
  return val
}

/**
 * Create a SQLite adapter using node:sqlite (Node.js 22.5+).
 * Uses the built-in DatabaseSync — no native addon required.
 */
async function createNodeSqliteAdapter(filename: string): Promise<DatabaseAdapter> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(filename)

  return {
    async query(sql: string, args?: SQLInputValue[]): Promise<QueryResult> {
      const stmt = db.prepare(sql)
      const rows = args ? stmt.all(...args) : stmt.all()
      if (rows.length === 0) {
        return { columns: [], rows: [] }
      }
      const columns = Object.keys(rows[0])
      return {
        columns,
        rows: rows.map((row: Record<string, unknown>) => columns.map((c) => normalizeValue(row[c]))),
      }
    },
    async exec(sql: string, args?: SQLInputValue[]): Promise<ExecResult> {
      if (args && args.length > 0) {
        const result = db.prepare(sql).run(...args)
        return { rowsAffected: Number(result.changes) }
      }
      db.exec(sql)
      return { rowsAffected: 0 }
    },
    async close(): Promise<void> {
      db.close()
    },
  }
}

/**
 * Create a SQLite adapter using bun:sqlite (Bun runtime).
 * Uses dynamic import since bun:sqlite is only available in Bun.1`
 */
async function createBunSqliteAdapter(filename: string): Promise<DatabaseAdapter> {
  // @ts-expect-error -- bun:sqlite only exists in the Bun runtime; guarded by isBun check
  const { Database } = await import('bun:sqlite')
  const db = new Database(filename)

  return {
    async query(sql: string, args?: unknown[]): Promise<QueryResult> {
      const stmt = db.query(sql)
      const columns = stmt.columnNames
      const rows = args ? stmt.values(...args) : stmt.values()
      return {
        columns,
        rows: (rows as unknown[][]).map((row) => row.map(normalizeValue)),
      }
    },
    async exec(sql: string, args?: unknown[]): Promise<ExecResult> {
      if (args && args.length > 0) {
        const stmt = db.query(sql)
        const result = stmt.run(...args)
        return { rowsAffected: result.changes ?? 0 }
      }
      db.exec(sql)
      return { rowsAffected: 0 }
    },
    async close(): Promise<void> {
      db.close()
    },
  }
}

/**
 * Create a SQLite DatabaseAdapter with runtime detection.
 * Detects whether running in Bun or Node and uses the appropriate driver:
 * - Bun: uses built-in bun:sqlite (zero dependencies)
 * - Node: uses node:sqlite (built-in, Node 22.5+)
 */
export async function createSqliteAdapter(filename: string): Promise<DatabaseAdapter> {
  const isBun = typeof (globalThis as any).Bun !== 'undefined'

  if (isBun) {
    return createBunSqliteAdapter(filename)
  }

  return createNodeSqliteAdapter(filename)
}
