// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/internal/sqlx/dev.go

import type { ExecQuerier } from '../schema/inspect.ts'
import type { Inspector } from '../schema/inspect.ts'
import { scanStmts } from '../migrate/lex.ts'
import type { Realm } from '../schema/schema.ts'

/** A function that restores the dev database to its pre-snapshot state. */
export type RestoreFunc = () => Promise<void>

/** Options for the dev database snapshot. */
export interface SnapshotOptions {
  /** Schema name to inspect. If empty, inspects the default/attached schema. */
  schema?: string
  /** SQL dialect for quoting. */
  dialect?: 'postgres' | 'mysql' | 'sqlite'
}

/**
 * Create a restore function that reverts the dev database to the given desired state.
 * Matches Go Atlas's Snapshot/RestoreFunc pattern:
 *
 * - PostgreSQL (single public schema, empty): DROP SCHEMA CASCADE + recreate
 * - General: diff current→desired + apply changes
 *
 * @param db - Database connection
 * @param inspector - Schema inspector
 * @param desired - The desired (usually empty) state to restore to
 * @param dialect - SQL dialect
 * @param diffAndApply - Function to compute diff and apply changes (provided by caller)
 */
export function createRestoreFunc(
  db: ExecQuerier,
  inspector: Inspector,
  desired: Realm,
  dialect: string,
  diffAndApply: (current: Realm, desired: Realm) => Promise<void>,
): RestoreFunc {
  const isSqlite = dialect === 'sqlite'
  const isMySQL = dialect === 'mysql'
  const isPostgres = !isSqlite && !isMySQL

  // Fast path for Postgres with single empty public schema (matches Go Atlas RealmRestoreFunc)
  if (
    isPostgres &&
    desired.schemas.length <= 1 &&
    desired.schemas[0]?.name === 'public' &&
    (desired.schemas[0]?.tables?.length ?? 0) === 0 &&
    (desired.schemas[0]?.views?.length ?? 0) === 0 &&
    (desired.schemas[0]?.funcs?.length ?? 0) === 0 &&
    (desired.schemas[0]?.procs?.length ?? 0) === 0
  ) {
    return async () => {
      const current = await inspector.inspectRealm()
      // Already clean
      if (current.schemas.length === 0) return
      if (
        current.schemas.length === 1 &&
        current.schemas[0].name === 'public' &&
        (current.schemas[0].tables?.length ?? 0) === 0 &&
        (current.schemas[0].views?.length ?? 0) === 0 &&
        (current.schemas[0].funcs?.length ?? 0) === 0 &&
        (current.schemas[0].procs?.length ?? 0) === 0
      ) {
        return
      }
      // Drop all schemas and recreate public
      const stmts: string[] = []
      for (const schema of current.schemas) {
        stmts.push(`DROP SCHEMA IF EXISTS "${schema.name}" CASCADE`)
      }
      stmts.push('CREATE SCHEMA IF NOT EXISTS "public"')
      await db.exec(stmts.join(';\n'))
    }
  }

  // General path: diff current→desired and apply changes (matches Go Atlas)
  return async () => {
    const current = await inspector.inspectRealm()
    await diffAndApply(current, desired)
  }
}

/**
 * Capture a schema snapshot from a dev database.
 * Matches Go Atlas's NormalizeRealm/NormalizeSchema pattern:
 *
 * 1. Take a snapshot (capture restore function for current empty state)
 * 2. Execute SQL files against the dev database
 * 3. Inspect the resulting schema
 * 4. Restore the dev database to its pre-snapshot state
 * 5. Return the captured Realm
 *
 * Security: Only executes against dev databases (pglite/sqlite), never production.
 */
export async function snapshot(
  db: ExecQuerier,
  inspector: Inspector,
  files: string[],
  opts: SnapshotOptions & { restore: RestoreFunc },
): Promise<Realm> {
  // Execute each SQL file's statements against the dev database
  for (const sql of files) {
    if (sql.trim() === '') continue
    const statements = scanStmts(sql)
    for (const stmt of statements) {
      if (stmt.text.trim() === '') continue
      await db.exec(stmt.text)
    }
  }

  // Inspect the resulting schema
  const realm = await inspector.inspectRealm(opts?.schema ? { schemas: [opts.schema] } : undefined)

  // Restore the dev database to its pre-snapshot state
  await opts.restore()

  return realm
}
