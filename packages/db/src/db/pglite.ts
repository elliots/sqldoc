import { PGlite } from '@electric-sql/pglite'
import type { DatabaseAdapter, ExecResult, QueryResult } from './types.ts'

/**
 * Normalize a row value to a type the Go database/sql driver can scan.
 */
function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null
  if (typeof val === 'bigint') return val.toString()
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'object') {
    return JSON.stringify(val, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  }
  return val
}

/**
 * Dynamically load a pglite extension.
 * Tries @electric-sql/pglite/contrib/{name} first (most extensions),
 * then @electric-sql/pglite/{name} (built-in extensions like live).
 * Returns the extension object or null if not available.
 */
async function loadPgliteExtension(name: string): Promise<any | null> {
  // Try contrib first (most extensions live here)
  try {
    const mod = await import(`@electric-sql/pglite/contrib/${name}`)
    return mod.default ?? mod[name] ?? mod
  } catch {
    /* not in contrib */
  }

  // Try top-level (built-in extensions like live, vector)
  try {
    const mod = await import(`@electric-sql/pglite/${name}`)
    return mod.default ?? mod[name] ?? mod
  } catch {
    /* not available */
  }

  return null
}

/**
 * Create a pglite-based DatabaseAdapter (in-memory, zero-config).
 * Optionally loads extensions from @electric-sql/pglite/contrib.
 */
export async function createPgliteAdapter(extensions?: string[]): Promise<DatabaseAdapter> {
  const extModules: Record<string, any> = {}
  for (const ext of extensions ?? []) {
    const mod = await loadPgliteExtension(ext)
    if (mod) {
      extModules[ext] = mod
    }
  }

  const db = await PGlite.create({
    extensions: Object.keys(extModules).length > 0 ? extModules : undefined,
  })

  return {
    async query(sql: string, args?: unknown[]): Promise<QueryResult> {
      const result = await db.query(sql, args, { rowMode: 'array' })
      return {
        columns: result.fields.map((f: { name: string }) => f.name),
        rows: (result.rows as unknown[][]).map((row) => row.map(normalizeValue)),
      }
    },
    async exec(sql: string): Promise<ExecResult> {
      const result = await db.exec(sql)
      const last = result[result.length - 1]
      return { rowsAffected: last?.affectedRows ?? 0 }
    },
    async close(): Promise<void> {
      await db.close()
    },
  }
}
