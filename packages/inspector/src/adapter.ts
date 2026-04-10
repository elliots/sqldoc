/**
 * DatabaseAdapter abstracts the database connection used by the inspector.
 * Adapter implementations (pglite, postgres, mysql, sqlite) satisfy this interface.
 */
export interface DatabaseAdapter {
  query(sql: string, args?: unknown[]): Promise<QueryResult>
  exec(sql: string, args?: unknown[]): Promise<ExecResult>
  close(): Promise<void>
}

/**
 * Result of a SELECT-style query.
 * Columns are returned separately from rows for lossless column access.
 */
export interface QueryResult {
  columns: string[]
  rows: unknown[][]
}

/**
 * Result of a DDL/DML execution.
 */
export interface ExecResult {
  rowsAffected: number
}
