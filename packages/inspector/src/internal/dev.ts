// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/internal/sqlx/dev.go

import type { DatabaseEngine } from '../dialects.ts'
import { getEngineStatementBatchSize, scanEngineStatements } from '../dialects.ts'
import type { ExecQuerier } from '../schema/inspect.ts'

/**
 * Execute SQL files against a fresh dev database.
 *
 * Each DbSource.open() returns a brand-new empty database, so there's no need
 * for the snapshot/restore pattern the Go runtime used. Callers simply open a
 * DB, call executeFiles(), inspect, and close the adapter.
 *
 * Statements within each file are batched (dialect-specific size) for fewer
 * round-trips; on batch failure we retry one-by-one so errors point at the
 * offending statement.
 */
export async function executeFiles(db: ExecQuerier, files: string[], engine?: DatabaseEngine): Promise<void> {
  const statementBatchSize = getEngineStatementBatchSize(engine)
  for (const sql of files) {
    if (sql.trim() === '') continue
    const statements = scanEngineStatements(sql, engine).filter((s) => s.text.trim() !== '')
    for (let i = 0; i < statements.length; i += statementBatchSize) {
      const batch = statements.slice(i, i + statementBatchSize)
      const batchSQL = `${batch.map((s) => s.text).join(';\n')};`
      try {
        await db.exec(batchSQL)
      } catch {
        // Fall back to one-by-one so the error points at the specific statement.
        for (const stmt of batch) {
          await db.exec(stmt.text)
        }
      }
    }
  }
}
