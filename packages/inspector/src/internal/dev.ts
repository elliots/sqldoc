// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/internal/sqlx/dev.go

import type { DatabaseEngine } from '../dialects.ts'
import { getEngineStatementBatchSize, scanEngineStatements } from '../dialects.ts'

import type { ExecQuerier, Inspector } from '../schema/inspect.ts'
import type { Change } from '../schema/migrate.ts'
import type { Realm } from '../schema/schema.ts'

/** A function that restores the dev database to its pre-snapshot state. */
export type RestoreFunc = () => Promise<void>

/** Optional function to transform changes before applying (e.g. Postgres withCascade). */
export type TransformChanges = (changes: Change[]) => Change[]

/** Options for the dev database snapshot. */
export interface SnapshotOptions {
  /** Schema name to inspect. If empty, inspects the default/attached schema. */
  schema?: string
  /** SQL engine identity for statement scanning and batching. */
  engine?: DatabaseEngine
}

/**
 * Create a restore function that reverts the dev database to the given desired state.
 * Uses general diff+apply for all dialects — no fragile fast paths.
 *
 * @param db - Database connection
 * @param inspector - Schema inspector
 * @param desired - The desired (usually empty) state to restore to
 * @param dialect - SQL dialect
 * @param diffAndApply - Function to compute diff and apply changes (provided by caller)
 * @param transformChanges - Optional transform applied before executing changes (e.g. Postgres withCascade)
 */
export function createRestoreFunc(
  inspector: Inspector,
  desired: Realm,
  diffAndApply: (current: Realm, desired: Realm, transformChanges?: TransformChanges) => Promise<void>,
  transformChanges?: TransformChanges,
): RestoreFunc {
  return async () => {
    const current = await inspector.inspectRealm()
    await diffAndApply(current, desired, transformChanges)
  }
}

/**
 * Capture a schema snapshot from a dev database.
 * Matches the original Go NormalizeRealm/NormalizeSchema pattern:
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
  try {
    // Execute each SQL file's statements against the dev database.
    // Uses dialect-specific scanner (matches Go Driver.ScanStmts per dialect).
    // Batches up to 50 statements per exec call, falls back to one-by-one on failure.
    const statementBatchSize = getEngineStatementBatchSize(opts.engine)
    for (const sql of files) {
      if (sql.trim() === '') continue
      const statements = scanEngineStatements(sql, opts.engine).filter((s) => s.text.trim() !== '')
      // MSSQL: no batching — CREATE PROCEDURE/FUNCTION must be the only statement in a batch
      for (let i = 0; i < statements.length; i += statementBatchSize) {
        const batch = statements.slice(i, i + statementBatchSize)
        const batchSQL = `${batch.map((s) => s.text).join(';\n')};`
        try {
          await db.exec(batchSQL)
        } catch {
          // On batch failure, fall back to one-by-one for precise errors
          for (const stmt of batch) {
            await db.exec(stmt.text)
          }
        }
      }
    }

    // Inspect the resulting schema
    const realm = await inspector.inspectRealm(opts?.schema ? { schemas: [opts.schema] } : undefined)

    return realm
  } finally {
    // Restore the dev database to its pre-snapshot state
    await opts.restore()
  }
}
