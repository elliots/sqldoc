/**
 * SQLite DatabaseAdapter with runtime detection.
 * Uses bun:sqlite when running in Bun, node:sqlite when running in Node.
 * Both are synchronous APIs wrapped in async methods to match the DatabaseAdapter interface.
 */
import type { SupportedValueType } from 'node:sqlite'
import type { DatabaseAdapter, ExecResult, QueryResult } from './types.ts'
import { isBun, normalizeValue } from './types.ts'

async function createBunSqliteAdapter(filename: string): Promise<DatabaseAdapter> {
  // @ts-expect-error -- bun:sqlite only exists in the Bun runtime
  const { Database } = await import('bun:sqlite')
  const db = new Database(filename)

  return {
    async query(sql: string, args?: unknown[]): Promise<QueryResult> {
      const stmt = db.query(sql)
      const columns = stmt.columnNames
      const rows = args ? stmt.values(...args) : stmt.values()
      return {
        columns,
        rows: (rows as unknown[][]).map((row) => row.map((v) => normalizeValue(v))),
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

async function createNodeSqliteAdapter(filename: string): Promise<DatabaseAdapter> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(filename)

  return {
    async query(sql: string, args?: unknown[]): Promise<QueryResult> {
      const stmt = db.prepare(sql)
      const rows = (args ? stmt.all(...(args as SupportedValueType[])) : stmt.all()) as Record<string, unknown>[]
      const columns =
        rows.length > 0 ? Object.keys(rows[0]) : ((stmt as any).columns?.()?.map((c: any) => c.name) ?? [])
      return {
        columns,
        rows: rows.map((row: Record<string, unknown>) => columns.map((c: string) => normalizeValue(row[c]))),
      }
    },
    async exec(sql: string, args?: unknown[]): Promise<ExecResult> {
      if (args && args.length > 0) {
        const result = db.prepare(sql).run(...(args as SupportedValueType[]))
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

export async function createSqliteAdapter(filename: string): Promise<DatabaseAdapter> {
  if (isBun) return createBunSqliteAdapter(filename)
  return createNodeSqliteAdapter(filename)
}
