/**
 * DatabaseAdapter abstracts the database connection used by the inspector.
 * Adapter implementations (pglite, postgres, mysql, sqlite) satisfy this interface.
 */
export interface DatabaseAdapter {
  query(sql: string, args?: unknown[]): Promise<QueryResult>
  exec(sql: string, args?: unknown[]): Promise<ExecResult>
  close(): Promise<void>
  /** The current/default schema name, detected at connection time. */
  currentSchema: string
}

/**
 * A DbSource produces fresh, isolated DatabaseAdapter instances on demand.
 * Each open() returns a brand-new empty database; closing the returned
 * adapter disposes that database. The inspector uses this to allocate a
 * working dev DB per operation — parallel diff() calls open() twice so each
 * side gets its own sandbox.
 *
 * Implementations live in @sqldoc/db:
 *   - in-memory sources (pglite, sqlite) spin up a new instance per open
 *   - server sources create a shadow database on an existing server
 *   - container sources run a docker image and create shadow databases in it
 *
 * The inspector never inspects the DbSource's implementation details — it
 * just opens a DB, uses it, and closes it.
 */
export interface DbSource {
  /** Open a fresh empty database. Close the returned adapter to dispose it. */
  open(): Promise<DatabaseAdapter>
  /** Release any long-lived resources held by the source (admin connection, container). */
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
