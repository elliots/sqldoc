/**
 * SQLite DatabaseAdapter with runtime detection.
 * Uses bun:sqlite when running in Bun, better-sqlite3 when running in Node.
 * Both are synchronous APIs wrapped in async methods to match the DatabaseAdapter interface.
 */
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
 * Create a SQLite adapter using better-sqlite3 (Node.js runtime).
 * Uses require() for the native addon to avoid ESM import issues.
 */
function createBetterSqlite3Adapter(filename: string): DatabaseAdapter {
  const Database = require('better-sqlite3')
  const db = new Database(filename)

  // Enable WAL mode for file-based databases (better concurrent read performance)
  if (filename !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }

  return {
    async query(sql: string, args?: unknown[]): Promise<QueryResult> {
      const stmt = db.prepare(sql)
      const columns = stmt.columns().map((c: { name: string }) => c.name)
      const rows = stmt.raw().all(...(args ?? []))
      return {
        columns,
        rows: (rows as unknown[][]).map((row) => row.map(normalizeValue)),
      }
    },
    async exec(sql: string, args?: unknown[]): Promise<ExecResult> {
      if (args && args.length > 0) {
        const result = db.prepare(sql).run(...args)
        return { rowsAffected: result.changes }
      }
      // Multi-statement DDL -- exec returns no metadata
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
 * Uses dynamic import since bun:sqlite is only available in Bun.
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
        stmt.run(...args)
        return { rowsAffected: db.changes }
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
 * - Node: uses better-sqlite3 (native addon)
 */
export async function createSqliteAdapter(filename: string): Promise<DatabaseAdapter> {
  const isBun = typeof (globalThis as any).Bun !== 'undefined'

  if (isBun) {
    return createBunSqliteAdapter(filename)
  }

  return createBetterSqlite3Adapter(filename)
}
