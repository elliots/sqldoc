/**
 * DatabaseAdapter abstracts the database connection used by the Atlas WASI host.
 * Both pglite (in-memory, zero-config) and pg (external Postgres) implement this.
 */
export interface DatabaseAdapter {
  query(sql: string, args?: unknown[]): Promise<QueryResult>
  exec(sql: string, args?: unknown[]): Promise<ExecResult>
  close(): Promise<void>
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
