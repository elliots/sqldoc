/**
 * Detect destructive SQL statements in migration diff output.
 *
 * Scans individual SQL statements for patterns that would destroy data:
 * - DROP TABLE
 * - ALTER TABLE ... DROP COLUMN
 * - DROP INDEX
 * - DROP VIEW
 * - DROP FUNCTION
 * - TRUNCATE
 */

export interface DestructiveChange {
  /** Human-readable description of the destructive change */
  description: string
  /** The full SQL statement */
  statement: string
}

/**
 * Scan an array of SQL statements for destructive operations.
 * Returns a list of destructive changes found (empty if none).
 */
export function detectDestructiveChanges(statements: string[]): DestructiveChange[] {
  const changes: DestructiveChange[] = []

  for (const stmt of statements) {
    // Normalize whitespace but preserve original case for names
    const normalized = stmt.replace(/\s+/g, ' ').trim()

    // DROP TABLE
    const dropTable = normalized.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/i)
    if (dropTable) {
      changes.push({
        description: `DROP TABLE ${unquote(dropTable[1])}`,
        statement: stmt,
      })
      continue
    }

    // ALTER TABLE ... DROP COLUMN
    const dropColumn = normalized.match(
      /ALTER\s+TABLE\s+(?:ONLY\s+)?("?[\w.]+"?)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/i,
    )
    if (dropColumn) {
      changes.push({
        description: `ALTER TABLE ${unquote(dropColumn[1])} DROP COLUMN ${unquote(dropColumn[2])}`,
        statement: stmt,
      })
      continue
    }

    // DROP INDEX
    const dropIndex = normalized.match(/DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/i)
    if (dropIndex) {
      changes.push({
        description: `DROP INDEX ${unquote(dropIndex[1])}`,
        statement: stmt,
      })
      continue
    }

    // DROP VIEW
    const dropView = normalized.match(/DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/i)
    if (dropView) {
      changes.push({
        description: `DROP VIEW ${unquote(dropView[1])}`,
        statement: stmt,
      })
      continue
    }

    // DROP FUNCTION
    const dropFunction = normalized.match(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/i)
    if (dropFunction) {
      changes.push({
        description: `DROP FUNCTION ${unquote(dropFunction[1])}`,
        statement: stmt,
      })
      continue
    }

    // TRUNCATE
    const truncate = normalized.match(/TRUNCATE\s+(?:TABLE\s+)?("?[\w.]+"?)/i)
    if (truncate) {
      changes.push({
        description: `TRUNCATE ${unquote(truncate[1])}`,
        statement: stmt,
      })
    }
  }

  return changes
}

/** Remove surrounding double quotes from an identifier */
function unquote(name: string): string {
  return name.replace(/^"(.*)"$/, '$1')
}
