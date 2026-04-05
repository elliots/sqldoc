/**
 * Neon serverless PostgreSQL adapter for sqldoc.
 *
 * Connects to an existing Neon database using @neondatabase/serverless.
 * Intended for read-only use cases like drift detection against a live
 * Neon database (schema diff against production).
 *
 * devUrl format: neon://ep-xxx.us-east-2.aws.neon.tech/dbname
 */
import { neon } from '@neondatabase/serverless'
import type { AdapterPluginContext, DatabaseAdapter, DatabaseAdapterPlugin, ExecResult, QueryResult } from '@sqldoc/db'
import { normalizeValue } from '@sqldoc/db'

const plugin: DatabaseAdapterPlugin = {
  apiVersion: 1,
  name: 'neon',
  schemes: ['neon'],
  dialects: ['postgres'],
  runtime: 'any',

  async createAdapter(devUrl: string, _context: AdapterPluginContext): Promise<DatabaseAdapter> {
    // Transform neon:// → postgres:// for the serverless driver
    const connectionString = devUrl.replace(/^neon:\/\//, 'postgres://')
    const sql = neon(connectionString, { fullResults: true })

    return {
      async query(queryText: string, args?: unknown[]): Promise<QueryResult> {
        const result = args && args.length > 0 ? await sql(queryText, args) : await sql(queryText)
        if (result.rows.length === 0) {
          return { columns: result.fields.map((f) => f.name), rows: [] }
        }
        const columns = result.fields.map((f) => f.name)
        return {
          columns,
          rows: result.rows.map((row: Record<string, unknown>) => columns.map((c) => normalizeValue(row[c]))),
        }
      },
      async exec(queryText: string): Promise<ExecResult> {
        const result = await sql(queryText)
        return { rowsAffected: result.rowCount ?? 0 }
      },
      async close(): Promise<void> {
        // Neon serverless is stateless — no connection to close
      },
    }
  },
}

export default plugin
