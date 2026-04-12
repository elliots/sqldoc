/**
 * Dialect-specific SQL generation utilities.
 *
 * Centralizes identifier quoting, string escaping, and common SQL patterns
 * that differ across Postgres, MySQL, and SQLite. Used by buildMergedSql
 * and by plugins that generate dialect-aware SQL.
 */

export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql'

/**
 * Quote a SQL identifier for the target dialect.
 * Postgres/SQLite: "name" (double quotes)
 * MySQL: `name` (backticks)
 */
export function quoteIdentifier(name: string, dialect: Dialect): string {
  switch (dialect) {
    case 'mysql':
      return `\`${name.replace(/`/g, '``')}\``
    case 'mssql':
      return `[${name.replace(/]/g, ']]')}]`
    case 'postgres':
    case 'sqlite':
      return `"${name.replace(/"/g, '""')}"`
  }
}

/**
 * Escape a SQL string literal for the target dialect.
 * All dialects: single quotes with '' escaping.
 */
export function escapeString(value: string, _dialect: Dialect): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Escape a SQL string that may contain newlines.
 * Postgres uses E'...' for strings with escape sequences.
 * MySQL and SQLite handle newlines in regular string literals.
 */
export function escapeStringWithNewlines(value: string, dialect: Dialect): string {
  const escaped = value.replace(/'/g, "''")
  if (value.includes('\n') || value.includes('\\n')) {
    switch (dialect) {
      case 'postgres':
        return `E'${escaped}'`
      case 'mysql':
      case 'sqlite':
      case 'mssql':
        return `'${escaped}'`
    }
  }
  return `'${escaped}'`
}

/**
 * Generate a COMMENT ON statement for the target dialect.
 * Postgres: COMMENT ON {type} {name} IS '...';
 * MySQL: ALTER TABLE ... COMMENT '...' (tables/columns only, Phase 3)
 * SQLite: not supported (returns null)
 *
 * Note: MySQL and SQLite support is stub -- returns null for non-Postgres.
 * Phase 3 will implement full dialect-specific comment generation in plugins.
 */
export function commentOn(objectType: string, objectName: string, comment: string, dialect: Dialect): string | null {
  switch (dialect) {
    case 'postgres':
      return `COMMENT ON ${objectType} ${quoteIdentifier(objectName, dialect)} IS ${escapeString(comment, dialect)};`
    case 'mysql':
    case 'sqlite':
    case 'mssql':
      // Stub: MySQL, SQLite, and MSSQL comment support is handled per-plugin
      return null
  }
}

/**
 * Get the auto-increment column type for the target dialect.
 * Postgres: SERIAL / BIGSERIAL
 * MySQL: INT AUTO_INCREMENT
 * SQLite: INTEGER (with AUTOINCREMENT on primary key)
 */
export function autoIncrementType(size: 'int' | 'bigint', dialect: Dialect): string {
  switch (dialect) {
    case 'postgres':
      return size === 'bigint' ? 'BIGSERIAL' : 'SERIAL'
    case 'mysql':
      return size === 'bigint' ? 'BIGINT AUTO_INCREMENT' : 'INT AUTO_INCREMENT'
    case 'mssql':
      return size === 'bigint' ? 'BIGINT IDENTITY(1,1)' : 'INT IDENTITY(1,1)'
    case 'sqlite':
      return 'INTEGER'
  }
}

/**
 * Get the current timestamp expression for the target dialect.
 */
export function currentTimestamp(dialect: Dialect): string {
  switch (dialect) {
    case 'postgres':
    case 'mysql':
      return 'NOW()'
    case 'mssql':
      return 'GETDATE()'
    case 'sqlite':
      return "datetime('now')"
  }
}

/**
 * Get the JSON object constructor function name for the target dialect.
 * Postgres: jsonb_build_object
 * MySQL: JSON_OBJECT
 * SQLite: json_object
 */
export function jsonObjectFunction(dialect: Dialect): string {
  switch (dialect) {
    case 'postgres':
      return 'jsonb_build_object'
    case 'mysql':
    case 'mssql':
      return 'JSON_OBJECT'
    case 'sqlite':
      return 'json_object'
  }
}

/**
 * Get the timestamp column type for the target dialect.
 * Postgres: TIMESTAMPTZ (timezone-aware)
 * MySQL: TIMESTAMP
 * SQLite: TEXT (no native timestamp type)
 */
export function timestampType(dialect: Dialect): string {
  switch (dialect) {
    case 'postgres':
      return 'TIMESTAMPTZ'
    case 'mysql':
      return 'TIMESTAMP'
    case 'mssql':
      return 'DATETIME2'
    case 'sqlite':
      return 'TEXT'
  }
}

/**
 * Get the JSON column type for the target dialect.
 * Postgres: JSONB (binary JSON with indexing)
 * MySQL: JSON
 * SQLite: TEXT (no native JSON type)
 */
export function jsonType(dialect: Dialect): string {
  switch (dialect) {
    case 'postgres':
      return 'JSONB'
    case 'mysql':
      return 'JSON'
    case 'mssql':
      return 'NVARCHAR(MAX)'
    case 'sqlite':
      return 'TEXT'
  }
}
