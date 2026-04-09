// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/sqlite/driver.go, sql/sqlite/driver_oss.go, sql/sqlite/inspect.go

import type { Attr, SchemaType } from '../schema/schema.ts'
import { isLiteralBool, isLiteralNumber, isQuoted, isUint, mayWrap } from '../internal/sqlx.ts'

// -- SQLite Standard Data Types --
// https://www.sqlite.org/datatype3.html

export const TypeInteger = 'integer'
export const TypeReal = 'real'
export const TypeText = 'text'
export const TypeBlob = 'blob'

// SQLite generated column types.
export const GeneratedVirtual = 'VIRTUAL'
export const GeneratedStored = 'STORED'

// Name of main database file.
export const mainFile = 'main'

// -- Query Constants --

/** Query to list attached database files. */
export const databasesQuery = "SELECT `name`, `file` FROM pragma_database_list() WHERE `name` <> 'temp'"
export const databasesQueryArgs = "SELECT `name`, `file` FROM pragma_database_list() WHERE `name` IN (%s)"

/** Query to list database tables. */
export const tablesQuery = `
SELECT
  sqlite_master.name, sqlite_master.sql, wr, strict
FROM
  sqlite_master
  JOIN pragma_table_list(sqlite_master.name)
WHERE
  sqlite_master.type = 'table'
  AND sqlite_master.name NOT LIKE 'sqlite_%'
  AND sqlite_master.name NOT LIKE 'libsql_%'
`

/** Query to list table column information (extended, with hidden columns). */
export const columnsQuery = "SELECT `name`, `type`, (not `notnull`) AS `nullable`, `dflt_value`, (`pk` <> 0) AS `pk`, `hidden` FROM pragma_table_xinfo('%s') ORDER BY `cid`"

/** Query to list table indexes. */
export const indexesQuery = "SELECT `il`.`name`, `il`.`unique`, `il`.`origin`, `il`.`partial`, `m`.`sql` FROM pragma_index_list('%s') AS il JOIN sqlite_master AS m ON il.name = m.name"

/** Query to list index columns. */
export const indexColumnsQuery = "SELECT name, desc FROM pragma_index_xinfo('%s') WHERE key = 1 ORDER BY seqno"

/** Query to list table foreign-keys. */
export const fksQuery = "SELECT `id`, `from`, `to`, `table`, `on_update`, `on_delete` FROM pragma_foreign_key_list('%s') ORDER BY id, seq"

/** Query to list database views. */
export const viewsQuery = "SELECT name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name"

/** Query to list database triggers. */
export const triggersQuery = "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name"

// -- SQLite-specific Attribute Types --

/** Describes the SQL statement used to create a resource. */
export interface CreateStmt {
  kind: 'create_stmt'
  S: string
  [key: string]: unknown
}

/** Describes the AUTOINCREMENT configuration. */
export interface AutoIncrement {
  kind: 'autoincrement'
  /** Sequence value from sqlite_sequence table. */
  seq?: number
  [key: string]: unknown
}

/** Describes the WITHOUT ROWID configuration. */
export interface WithoutRowID {
  kind: 'without_rowid'
  [key: string]: unknown
}

/** Describes the STRICT table configuration (SQLite 3.37+). */
export interface Strict {
  kind: 'strict'
  [key: string]: unknown
}

/** Describes a partial index predicate. */
export interface IndexPredicate {
  kind: 'index_predicate'
  P: string
  [key: string]: unknown
}

/** Describes how the index was created. */
export interface IndexOrigin {
  kind: 'index_origin'
  O: string
  [key: string]: unknown
}

/** Database file attribute. */
export interface FileAttr {
  kind: 'file'
  name: string
  [key: string]: unknown
}

/** SQLite-specific attribute types. */
export type SqliteAttr = CreateStmt | AutoIncrement | WithoutRowID | Strict | IndexPredicate | IndexOrigin | FileAttr

// -- Attribute Helpers --

/** Check if an attribute array contains an attribute of the given kind. */
export function hasAttr<T extends SqliteAttr>(attrs: Attr[] | undefined, kind: T['kind']): T | undefined {
  if (!attrs) return undefined
  return attrs.find(a => 'kind' in a && (a as any).kind === kind) as T | undefined
}

// -- Type Parsing --

/**
 * Split a SQLite column type string into parts.
 * Handles compound types like "varying character(255)".
 */
function columnParts(t: string): string[] {
  t = t.trim().toLowerCase()
  const parts = t.split(/[(),\s]+/).filter(Boolean)
  for (let k = 0; k < 2; k++) {
    // Join the type back if it was separated with space (e.g. 'varying character').
    if (parts.length > 1 && !isUint(parts[0]) && !isUint(parts[1])) {
      parts[1] = parts[0] + ' ' + parts[1]
      parts.splice(0, 1)
    }
  }
  return parts
}

/**
 * Parse a SQLite type name into a SchemaType.
 * Uses SQLite's type affinity rules and exact type name matching.
 */
export function parseType(c: string): SchemaType {
  // A datatype may be zero or more names.
  if (c === '') {
    return { kind: 'binary', T: 'blob' }
  }
  const parts = columnParts(c)
  const t = parts[0]
  switch (t) {
    case 'bool':
    case 'boolean':
      return { kind: 'boolean', T: t }

    case 'blob':
      return { kind: 'binary', T: t }

    case 'int2':
    case 'int8':
    case 'int':
    case 'uint64':
    case 'integer':
    case 'tinyint':
    case 'smallint':
    case 'mediumint':
    case 'bigint':
    case 'unsigned big int':
      return { kind: 'integer', T: t }

    case 'real':
    case 'double':
    case 'double precision':
    case 'float':
      return { kind: 'float', T: t }

    case 'numeric':
    case 'decimal': {
      const ct: SchemaType = { kind: 'decimal', T: t }
      if (parts.length > 1) {
        const p = parseInt(parts[1], 10)
        if (!Number.isNaN(p)) (ct as any).precision = p
      }
      if (parts.length > 2) {
        const s = parseInt(parts[2], 10)
        if (!Number.isNaN(s)) (ct as any).scale = s
      }
      return ct
    }

    case 'char':
    case 'character':
    case 'varchar':
    case 'varying character':
    case 'nchar':
    case 'native character':
    case 'nvarchar':
    case 'text':
    case 'clob': {
      const ct: SchemaType = { kind: 'string', T: t }
      if (parts.length > 1) {
        const p = parseInt(parts[1], 10)
        if (!Number.isNaN(p)) (ct as any).size = p
      }
      return ct
    }

    case 'json':
    case 'jsonb':
      return { kind: 'json', T: t }

    case 'date':
    case 'datetime':
    case 'time':
    case 'timestamp':
      return { kind: 'time', T: t }

    case 'uuid':
      return { kind: 'uuid', T: t }

    default:
      // User-defined type -- store the original full type string.
      return { kind: 'unsupported', T: c }
  }
}

// -- Default Expression Parsing --

/** Blob literals are hex strings preceded by 'x' (or 'X'). */
function isBlob(s: string): boolean {
  if ((s.startsWith("x'") || s.startsWith("X'")) && s.endsWith("'")) {
    const hex = s.slice(2, -1)
    return /^[0-9a-fA-F]*$/.test(hex)
  }
  return false
}

/**
 * Parse a default value expression.
 * Returns a Literal for literal values, RawExpr for everything else.
 */
export function defaultExpr(x: string): { V: string } | { X: string } {
  if (isLiteralBool(x) || isLiteralNumber(x) || isQuoted(x, '"', "'") || isBlob(x)) {
    return { V: x }
  }
  return { X: x }
}

// -- Expression Scanner --

/**
 * Scan a parenthesized expression from a string.
 * Returns the balanced expression including outer parens, or empty string if unbalanced.
 */
export function scanExpr(expr: string): string {
  let r = 0
  let l = 0
  for (let i = 0; i < expr.length; i++) {
    switch (expr[i]) {
      case '(':
        r++
        break
      case ')':
        l++
        break
      case "'":
      case '"': {
        // Skip unescaped strings.
        const j = expr.indexOf(expr[i], i + 1)
        if (j !== -1) i = j
        break
      }
    }
    // Balanced parens.
    if (r === l && r > 0) {
      return expr.slice(0, i + 1)
    }
  }
  return ''
}

// -- View Definition Extraction --

/**
 * Extract the SELECT definition from a SQLite CREATE VIEW statement.
 * The sql column in sqlite_master is: CREATE [TEMP] VIEW [IF NOT EXISTS] name AS def
 */
export function viewDef(stmt: string): string {
  const upper = stmt.toUpperCase()
  const idx = upper.indexOf(' AS ')
  if (idx === -1) return stmt
  return stmt.slice(idx + 4).trim()
}

// -- Trigger Metadata Parsing --

/**
 * Parse timing, event, and forEach from a CREATE TRIGGER statement.
 */
export function parseTriggerMeta(stmt: string): { timing?: string; events: string[]; forEach?: string } {
  const upper = stmt.toUpperCase()
  // Isolate the header (everything before BEGIN).
  let header = upper
  for (const sep of ['\nBEGIN', ' BEGIN']) {
    const idx = upper.indexOf(sep)
    if (idx !== -1) {
      header = upper.slice(0, idx)
      break
    }
  }

  let timing: string | undefined
  if (header.includes(' INSTEAD OF ')) timing = 'INSTEAD OF'
  else if (header.includes(' BEFORE ')) timing = 'BEFORE'
  else if (header.includes(' AFTER ')) timing = 'AFTER'

  const events: string[] = []
  if (header.includes(' INSERT')) events.push('INSERT')
  else if (header.includes(' DELETE')) events.push('DELETE')
  else if (header.includes(' UPDATE')) events.push('UPDATE')

  // SQLite only supports row-level triggers.
  return { timing, events, forEach: 'ROW' }
}

/**
 * Normalize stored/virtual type strings.
 * In Go source, this normalizes to the canonical STORED/VIRTUAL form.
 */
export function storedOrVirtual(typ: string | undefined): string {
  if (!typ) return GeneratedVirtual
  const upper = typ.toUpperCase().trim()
  if (upper === 'STORED') return GeneratedStored
  return GeneratedVirtual
}
