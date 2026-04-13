/**
 * DatabaseAdapter abstracts the database connection used by the schema runner host.
 * Both pglite (in-memory, zero-config) and pg (external Postgres) implement this.
 */
export interface DatabaseAdapter {
  query(sql: string, args?: unknown[]): Promise<QueryResult>
  exec(sql: string, args?: unknown[]): Promise<ExecResult>
  close(): Promise<void>
  /** The current/default schema name, detected at connection time. */
  currentSchema: string
}

/**
 * Result of a SELECT-style query.
 * Matches the WASI protocol Response shape for "query" requests.
 */
export interface QueryResult {
  columns: string[]
  rows: unknown[][]
}

/**
 * Result of a DDL/DML execution.
 * Matches the WASI protocol Response shape for "exec" requests.
 */
export interface ExecResult {
  rowsAffected: number
}

/** Whether we're running in Bun (vs Node.js) */
export const isBun = (globalThis as any).Bun !== undefined

// ── Adapter Plugin System ──────────────────────────────────────────

/** Supported SQL dialects. */
export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql'

/** Plugin interface for external database adapter packages. */
export interface DatabaseAdapterPlugin {
  apiVersion: 1
  name: string
  /** URL schemes this plugin handles (without '://') or keywords (e.g. 'pglite') */
  schemes: string[]
  /** SQL dialects this plugin supports */
  dialects: Dialect[]
  /** Runtime compatibility */
  runtime: 'bun' | 'node' | 'any'
  /** Create an adapter for the given devUrl */
  createAdapter(devUrl: string, context: AdapterPluginContext): Promise<DatabaseAdapter>
}

export interface AdapterPluginContext {
  dialect: Dialect
  extensions: string[]
}

/**
 * Normalize row values to types the Go database/sql driver can scan.
 * The WASI JSON protocol expects strings, numbers, booleans, and null.
 */
export function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null
  if (typeof val === 'bigint') return val.toString()
  if (val instanceof Date) return val.toISOString()
  if (Buffer.isBuffer(val) || val instanceof Uint8Array) return Buffer.from(val).toString('hex')
  if (typeof val === 'object') {
    return JSON.stringify(val, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  }
  return val
}

/**
 * Create a DatabaseAdapter using Bun's built-in SQL class.
 * Shared by both Postgres and MySQL Bun adapters.
 */
export async function createBunSqlAdapter(connectionString: string, connectionTimeout = 5): Promise<DatabaseAdapter> {
  // @ts-expect-error -- bun global only exists in Bun runtime
  const { SQL } = await import('bun')
  const pool = new SQL({ url: connectionString, connectionTimeout })
  // Reserve a dedicated connection — the runner bridge needs it to stay open
  const db = await pool.reserve()

  // Detect current schema at connection time
  const schemaRows = await db.unsafe('SELECT current_schema()').values()
  const currentSchema = (schemaRows[0] as unknown[])[0] as string

  return {
    currentSchema,
    async query(sql: string, args?: unknown[]): Promise<QueryResult> {
      // Use .values() — object-mode deduplicates column keys
      // (SELECT f('a'), f('b') → 1 key instead of 2)
      const valRows = args && args.length > 0 ? await db.unsafe(sql, args).values() : await db.unsafe(sql).values()
      if (valRows.length === 0) {
        return { columns: [], rows: [] }
      }
      const colCount = (valRows[0] as unknown[]).length
      const columns = Array.from({ length: colCount }, (_, i) => `col${i}`)
      return {
        columns,
        rows: (valRows as unknown[][]).map((row) => row.map((v) => normalizeValue(v))),
      }
    },
    async exec(sql: string, args?: unknown[]): Promise<ExecResult> {
      const result = args && args.length > 0 ? await db.unsafe(sql, args) : await db.unsafe(sql)
      return { rowsAffected: result.affectedRows ?? result.count ?? 0 }
    },
    async close(): Promise<void> {
      db.release()
      await pool.close()
    },
  }
}
