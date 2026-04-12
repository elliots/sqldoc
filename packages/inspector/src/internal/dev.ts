// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/internal/sqlx/dev.go

import type { Dialect } from '../inspector.ts'
import type { Stmt } from '../migrate/lex.ts'
import { mssqlScanStmts } from '../mssql/driver.ts'
import { mysqlScanStmts } from '../mysql/driver.ts'
import { postgresScanStmts } from '../postgres/driver.ts'
import { sqliteScanStmts } from '../sqlite/driver.ts'

/** Get the dialect-specific statement scanner. Matches Go Driver.ScanStmts per dialect. */
function dialectScanner(dialect?: Dialect): (input: string) => Stmt[] {
  switch (dialect) {
    case 'mysql':
      return mysqlScanStmts
    case 'mssql':
      return mssqlScanStmts
    case 'sqlite':
      return sqliteScanStmts
    default:
      return postgresScanStmts
  }
}

import type { ExecQuerier, Inspector } from '../schema/inspect.ts'
import type { Realm } from '../schema/schema.ts'

/** A function that restores the dev database to its pre-snapshot state. */
export type RestoreFunc = () => Promise<void>

/** Options for the dev database snapshot. */
export interface SnapshotOptions {
  /** Schema name to inspect. If empty, inspects the default/attached schema. */
  schema?: string
  /** SQL dialect for quoting. */
  dialect?: Dialect
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
  const _isSqlite = dialect === 'sqlite'
  const _isMySQL = dialect === 'mysql'
  const isMssql = dialect === 'mssql'
  const isPostgres = dialect === 'postgres'

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
        (current.schemas[0].procs?.length ?? 0) === 0 &&
        (current.schemas[0].triggers?.length ?? 0) === 0 &&
        ((current.schemas[0].attrs ?? []) as any[]).filter(
          (a) => a?.kind === 'enum' || a?.kind === 'domain' || a?.kind === 'range_type' || a?.kind === 'aggregate',
        ).length === 0
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

  // MSSQL fast path: drop all user objects in dbo (can't DROP SCHEMA dbo)
  if (isMssql) {
    return async () => {
      // Drop in dependency order: FKs, then tables, views, procs, funcs, triggers, sequences
      await db.exec(`
        DECLARE @sql NVARCHAR(MAX) = ''
        SELECT @sql += 'ALTER TABLE [' + s.name + '].[' + t.name + '] DROP CONSTRAINT [' + fk.name + '];'
        FROM sys.foreign_keys fk
        JOIN sys.tables t ON fk.parent_object_id = t.object_id
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
        EXEC(@sql)
      `)
      await db.exec(`
        DECLARE @sql NVARCHAR(MAX) = ''
        SELECT @sql += 'DROP TABLE [' + s.name + '].[' + t.name + '];'
        FROM sys.tables t
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
        EXEC(@sql)
      `)
      await db.exec(`
        DECLARE @sql NVARCHAR(MAX) = ''
        SELECT @sql += 'DROP VIEW [' + s.name + '].[' + v.name + '];'
        FROM sys.views v
        JOIN sys.schemas s ON v.schema_id = s.schema_id
        WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
        EXEC(@sql)
      `)
      await db.exec(`
        DECLARE @sql NVARCHAR(MAX) = ''
        SELECT @sql += 'DROP PROCEDURE [' + s.name + '].[' + o.name + '];'
        FROM sys.objects o
        JOIN sys.schemas s ON o.schema_id = s.schema_id
        WHERE o.type = 'P' AND s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
        EXEC(@sql)
      `)
      await db.exec(`
        DECLARE @sql NVARCHAR(MAX) = ''
        SELECT @sql += 'DROP FUNCTION [' + s.name + '].[' + o.name + '];'
        FROM sys.objects o
        JOIN sys.schemas s ON o.schema_id = s.schema_id
        WHERE o.type IN ('FN', 'IF', 'TF') AND s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
        EXEC(@sql)
      `)
      await db.exec(`
        DECLARE @sql NVARCHAR(MAX) = ''
        SELECT @sql += 'DROP SEQUENCE [' + s.name + '].[' + seq.name + '];'
        FROM sys.sequences seq
        JOIN sys.schemas s ON seq.schema_id = s.schema_id
        WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
        EXEC(@sql)
      `)
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
  try {
    // Execute each SQL file's statements against the dev database.
    // Uses dialect-specific scanner (matches Go Driver.ScanStmts per dialect).
    // Batches up to 50 statements per exec call, falls back to one-by-one on failure.
    const dialectScan = dialectScanner(opts.dialect)
    for (const sql of files) {
      if (sql.trim() === '') continue
      const statements = dialectScan(sql).filter((s) => s.text.trim() !== '')
      // MSSQL: no batching — CREATE PROCEDURE/FUNCTION must be the only statement in a batch
      const BATCH_SIZE = opts.dialect === 'mssql' ? 1 : 50
      for (let i = 0; i < statements.length; i += BATCH_SIZE) {
        const batch = statements.slice(i, i + BATCH_SIZE)
        const batchSQL = `${batch.map((s) => s.text).join(';\n')};`
        try {
          await db.exec(batchSQL)
        } catch {
          // On batch failure, fall back to one-by-one for precise errors.
          // Re-execute each statement individually — idempotent DDL (CREATE IF NOT EXISTS,
          // DROP IF EXISTS) handles already-applied statements safely.
          for (const stmt of batch) {
            try {
              await db.exec(stmt.text)
            } catch (stmtErr) {
              throw new Error(
                `failed to execute statement: ${stmt.text.slice(0, 200)}: ${(stmtErr as any)?.message ?? stmtErr}`,
              )
            }
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
