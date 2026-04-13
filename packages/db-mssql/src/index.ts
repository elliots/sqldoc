/**
 * MSSQL database adapter for sqldoc.
 * Uses the `mssql` (node-mssql) package which wraps tedious.
 */

import type { AdapterPluginContext, DatabaseAdapter, DatabaseAdapterPlugin, ExecResult, QueryResult } from '@sqldoc/db'
import { normalizeValue } from '@sqldoc/db'

/** Parse an mssql:// URL into a config object for the mssql package. */
function parseConnectionUrl(url: string): Record<string, unknown> {
  const parsed = new URL(url)
  const acceptUntrustedServerCertificate =
    parsed.searchParams.get('acceptUntrustedServerCertificate')?.toLowerCase() === 'true'
  return {
    server: parsed.hostname,
    port: parseInt(parsed.port || '1433', 10),
    database: parsed.pathname.replace(/^\//, '') || 'master',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    options: {
      encrypt: true,
      trustServerCertificate: acceptUntrustedServerCertificate,
    },
  }
}

function countPlaceholders(sql: string): number {
  return (sql.match(/\?/g) ?? []).length
}

/**
 * Replace `?` placeholders with `@p1, @p2, ...` for the mssql driver,
 * and bind the corresponding args to the request.
 */
function bindArgs(request: any, sql: string, args?: unknown[]): { sql: string; consumed: number } {
  const expected = countPlaceholders(sql)
  const actual = args?.length ?? 0
  if (actual !== expected) {
    throw new Error(`parameter count mismatch: expected ${expected}, got ${actual}`)
  }
  if (expected === 0) return { sql, consumed: 0 }

  let paramIndex = 0
  const replaced = sql.replace(/\?/g, () => {
    paramIndex++
    return `@p${paramIndex}`
  })

  for (let i = 0; i < expected; i++) {
    request.input(`p${i + 1}`, args![i])
  }

  return { sql: replaced, consumed: expected }
}

/** Split SQL text on GO batch separators (case-insensitive, standalone on a line). */
function splitGoBatches(sql: string): string[] {
  const batches: string[] = []
  let current = ''
  for (const line of sql.split('\n')) {
    if (/^\s*GO\s*$/i.test(line)) {
      const trimmed = current.trim()
      if (trimmed) batches.push(trimmed)
      current = ''
    } else {
      current += `${line}\n`
    }
  }
  const trimmed = current.trim()
  if (trimmed) batches.push(trimmed)
  return batches
}

const plugin: DatabaseAdapterPlugin = {
  apiVersion: 1,
  name: 'mssql',
  schemes: ['mssql', 'sqlserver'],
  dialects: ['mssql'],
  runtime: 'any',

  async createAdapter(connectionString: string, _context: AdapterPluginContext): Promise<DatabaseAdapter> {
    const mssql = await import('mssql')
    const config = parseConnectionUrl(connectionString)
    const pool = await mssql.default.connect(config as any)
    const log = process.env.DEBUG ? (msg: string) => console.error(`[mssql] ${msg}`) : () => {}

    let currentSchema: string
    try {
      const schemaResult = await pool.request().query('SELECT SCHEMA_NAME() AS s')
      const schemaName = schemaResult.recordset[0]?.s
      if (typeof schemaName !== 'string' || schemaName.length === 0) {
        throw new Error('mssql: SCHEMA_NAME() returned no current schema')
      }
      currentSchema = schemaName
    } catch (err) {
      await pool.close()
      throw err
    }

    return {
      currentSchema,
      async query(sql: string, args?: unknown[]): Promise<QueryResult> {
        const request = pool.request()
        const { sql: boundSql } = bindArgs(request, sql, args)
        log(`query: ${boundSql.replace(/\n/g, ' ').slice(0, 120)}`)
        const result = await request.query(boundSql)
        const recordset = result.recordset
        if (!recordset || recordset.length === 0) {
          return { columns: [], rows: [] }
        }
        const columns = Object.keys(recordset.columns).map((key) => recordset.columns[key].name)
        const rows = recordset.map((row: Record<string, unknown>) => columns.map((col) => normalizeValue(row[col])))
        return { columns, rows }
      },

      async exec(sql: string, args?: unknown[]): Promise<ExecResult> {
        const batches = splitGoBatches(sql)
        const expectedArgs = batches.reduce((count, batch) => count + countPlaceholders(batch), 0)
        const actualArgs = args?.length ?? 0
        if (actualArgs !== expectedArgs) {
          throw new Error(`parameter count mismatch: expected ${expectedArgs}, got ${actualArgs}`)
        }
        let totalAffected = 0
        let argOffset = 0
        for (const batch of batches) {
          const request = pool.request()
          const placeholderCount = countPlaceholders(batch)
          const batchArgs = args?.slice(argOffset, argOffset + placeholderCount) ?? []
          const { sql: boundSql, consumed } = bindArgs(request, batch, batchArgs)
          argOffset += consumed
          log(`exec: ${boundSql.replace(/\n/g, ' ').slice(0, 120)}`)
          const result = await request.query(boundSql)
          totalAffected += result.rowsAffected.reduce((a: number, b: number) => a + b, 0)
        }
        return { rowsAffected: totalAffected }
      },

      async close(): Promise<void> {
        await pool.close()
      },
    }
  },
}

export default plugin
