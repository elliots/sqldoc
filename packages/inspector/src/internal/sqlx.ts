// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/internal/sqlx/sqlx.go, sql/internal/sqlx/sqlx_oss.go

import type { Dialect } from '../dialects.ts'
import type { DiffOptions, InspectOptions, InspectRealmOption } from '../schema/inspect.ts'
import type { Change } from '../schema/migrate.ts'
import type {
  Attr,
  Column,
  ColumnType,
  Expr,
  Index,
  IndexPart,
  Realm,
  Schema,
  SchemaType,
  Table,
  View,
} from '../schema/schema.ts'

// -- Row Scanning Utilities --

/** Extract a string value from a query row at the given column index. Returns null if null. */
export function scanString(row: unknown[], col: number): string | null {
  const v = row[col]
  if (v == null) return null
  return String(v)
}

/** Extract a number value from a query row. Returns null if null. */
export function scanNumber(row: unknown[], col: number): number | null {
  const v = row[col]
  if (v == null) return null
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/** Extract a bigint value from a query row. Uses BigInt to preserve precision for large values. */
export function scanBigInt(row: unknown[], col: number): bigint | null {
  const v = row[col]
  if (v == null) return null
  if (typeof v === 'bigint') return v
  try {
    return BigInt(v as any)
  } catch {
    return null
  }
}

/** Extract a boolean value from a query row. Returns null if null. */
export function scanBool(row: unknown[], col: number): boolean | null {
  const v = row[col]
  if (v == null) return null
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const lower = v.toLowerCase()
    if (lower === 'true' || lower === '1' || lower === 't' || lower === 'yes') return true
    if (lower === 'false' || lower === '0' || lower === 'f' || lower === 'no') return false
  }
  return null
}

/**
 * Convenience: scan a row into an object with named fields.
 * Maps columns by position to field names.
 */
export function scanRow<T extends Record<string, unknown>>(
  row: unknown[],
  columns: string[],
  fields: (keyof T)[],
): Partial<T> {
  const result: Partial<T> = {}
  for (let i = 0; i < fields.length && i < columns.length; i++) {
    result[fields[i]] = row[i] as T[keyof T]
  }
  return result
}

// -- Type Validation Helpers --

/** Reports if the given value is a valid (non-null, non-empty) string. */
export function validString(v: unknown): v is string {
  if (typeof v !== 'string') return false
  if (v === '' || v.toLowerCase() === 'null') return false
  return true
}

/** Reports if the given value is a valid number. */
export function validNumber(v: unknown): v is number {
  return typeof v === 'number' && !Number.isNaN(v)
}

/** Reports if the given value is a valid boolean. */
export function validBool(v: unknown): v is boolean {
  return typeof v === 'boolean'
}

// -- Schema Linking Utilities --

/**
 * Link foreign key references to actual table/column objects within the realm.
 * After dialect-specific inspection queries return raw FK data, this function
 * resolves stub table/column references to actual schema objects.
 */
export function linkForeignKeys(realm: Realm): void {
  const bySchema = new Map<string, Map<string, Table>>()
  for (const s of realm.schemas) {
    const tables = new Map<string, Table>()
    for (const t of s.tables ?? []) {
      tables.set(t.name, t)
    }
    bySchema.set(s.name, tables)
  }
  for (const s of realm.schemas) {
    for (const t of s.tables ?? []) {
      for (const fk of t.foreignKeys ?? []) {
        // Resolve refTable by looking up in schema tables
        const refSchemaName = fk.refSchema ?? s.name
        const schemaTables = bySchema.get(refSchemaName)
        if (!schemaTables) continue
        const refTable = schemaTables.get(fk.refTable)
        if (refTable) {
          fk.refTable = refTable.name
          // Resolve refColumns to actual column names (already strings in our model)
        }
      }
    }
  }
}

/**
 * Build the indexes for a table from raw inspection data.
 * Groups index parts by index name and creates Index objects.
 */
export function buildIndexes(
  table: Table,
  rawParts: Array<{
    indexName: string
    columnName?: string
    expr?: string
    desc?: boolean
    unique?: boolean
    attrs?: Attr[]
  }>,
): void {
  const indexMap = new Map<string, { unique?: boolean; parts: IndexPart[]; attrs?: Attr[] }>()

  for (const raw of rawParts) {
    let idx = indexMap.get(raw.indexName)
    if (!idx) {
      idx = { unique: raw.unique, parts: [], attrs: raw.attrs }
      indexMap.set(raw.indexName, idx)
    }
    const part: IndexPart = {}
    if (raw.columnName) part.column = raw.columnName
    if (raw.expr) part.expr = raw.expr
    if (raw.desc) part.desc = true
    if (raw.attrs) part.attrs = raw.attrs
    idx.parts.push(part)
  }

  const indexes: Index[] = []
  indexMap.forEach((idx, name) => {
    indexes.push({
      name,
      unique: idx.unique,
      parts: idx.parts,
      attrs: idx.attrs,
    })
  })
  table.indexes = indexes
}

/**
 * Resolve a type string to a SchemaType.
 * This is dialect-independent base resolution (each dialect overrides for specifics).
 */
export function typeFromString(typeName: string): SchemaType {
  // Strip parenthesized modifiers for matching (e.g. varchar(255) -> varchar)
  // but keep the original typeName for the returned T value
  const stripped = typeName.replace(/\([^)]*\)/g, '').trim()
  const lower = stripped.toLowerCase()

  // Integer types
  if (/^(int|integer|bigint|smallint|tinyint|mediumint|int2|int4|int8)$/i.test(lower)) {
    return { kind: 'integer', T: typeName }
  }
  // Boolean
  if (/^(bool|boolean)$/i.test(lower)) {
    return { kind: 'boolean', T: typeName }
  }
  // Float types
  if (/^(float|real|float4|float8|double|double precision)$/i.test(lower)) {
    return { kind: 'float', T: typeName }
  }
  // Decimal types
  if (/^(decimal|numeric|money)$/i.test(lower)) {
    return { kind: 'decimal', T: typeName }
  }
  // String types
  if (/^(varchar|char|character|character varying|text|nchar|nvarchar|clob|bpchar|name)$/i.test(lower)) {
    return { kind: 'string', T: typeName }
  }
  // Time types
  if (
    /^(timestamp|timestamptz|date|time|timetz|datetime|timestamp with(out)? time zone|time with(out)? time zone)$/i.test(
      lower,
    )
  ) {
    return { kind: 'time', T: typeName }
  }
  // Binary types
  if (/^(bytea|blob|binary|varbinary|bit|varbit|bit varying)$/i.test(lower)) {
    return { kind: 'binary', T: typeName }
  }
  // JSON types
  if (/^(json|jsonb)$/i.test(lower)) {
    return { kind: 'json', T: typeName }
  }
  // UUID
  if (lower === 'uuid') {
    return { kind: 'uuid', T: typeName }
  }
  // Interval
  if (lower === 'interval') {
    return { kind: 'time', T: typeName }
  }

  return { kind: 'unsupported', T: typeName }
}

// -- Type Helpers --

/** Check if two SchemaTypes are equal. */
export function typesEqual(a: SchemaType, b: SchemaType): boolean {
  if (a.kind !== b.kind) return false
  if (a.T !== b.T) return false

  // Compare kind-specific fields
  switch (a.kind) {
    case 'string':
      return (a as any).size === (b as any).size
    case 'integer':
      return (a as any).unsigned === (b as any).unsigned
    case 'float':
      return (a as any).precision === (b as any).precision
    case 'decimal':
      return (a as any).precision === (b as any).precision && (a as any).scale === (b as any).scale
    case 'time':
      return (a as any).precision === (b as any).precision
    case 'binary':
      return (a as any).size === (b as any).size
    case 'enum':
      return valuesEqual((a as any).values ?? [], (b as any).values ?? [])
    case 'array':
      return typesEqual((a as any).type, (b as any).type)
    default:
      return true
  }
}

/** Get the SQL string representation of a SchemaType. */
export function typeString(t: SchemaType): string {
  return t.T
}

/** Check if a column has a default value. */
export function hasDefault(col: Column): boolean {
  return col.default !== undefined
}

/** Compare two expressions for equality. */
export function exprEqual(a: Expr | undefined, b: Expr | undefined): boolean {
  if (a === undefined && b === undefined) return true
  if (a === undefined || b === undefined) return false
  if ('X' in a && 'X' in b) return a.X === b.X
  if ('V' in a && 'V' in b) return a.V === b.V
  return false
}

/** Compare two Attr arrays for equality. */
export function attrsEqual(a: Attr[] | undefined, b: Attr[] | undefined): boolean {
  const aa = a ?? []
  const bb = b ?? []
  if (aa.length !== bb.length) return false
  for (let i = 0; i < aa.length; i++) {
    if (!attrEqual(aa[i], bb[i])) return false
  }
  return true
}

/** Compare two individual Attr values for equality. */
function attrEqual(a: Attr, b: Attr): boolean {
  if ('kind' in a && 'kind' in b) {
    if ((a as any).kind !== (b as any).kind) return false
    // Compare common attr fields
    const ak = a as any
    const bk = b as any
    switch (ak.kind) {
      case 'comment':
        return ak.text === bk.text
      case 'collation':
      case 'charset':
        return ak.V === bk.V
      case 'generated':
        return ak.expr === bk.expr && ak.type === bk.type
      case 'tag':
        return ak.name === bk.name && ak.args === bk.args
      default:
        return JSON.stringify(a) === JSON.stringify(b)
    }
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Check if two ColumnType wrappers are equal. */
export function columnTypesEqual(a: ColumnType, b: ColumnType): boolean {
  if (a.null !== b.null) return false
  return typesEqual(a.type, b.type)
}

// -- Query Helpers --

/** Build a positional parameter list: $1, $2, ... $n (for postgres). */
export function pgArgs(start: number, count: number): string {
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    parts.push(`$${start + i}`)
  }
  return parts.join(', ')
}

/** Build a positional parameter list: ?, ?, ... ? (for mysql/sqlite). */
export function mysqlArgs(count: number): string {
  return Array(count).fill('?').join(', ')
}

/**
 * Conditionally build WHERE IN clause with parameter placeholders.
 * Dialect determines placeholder style ($N vs ?).
 */
export function inClause(dialect: Dialect, paramStart: number, count: number): string {
  if (count === 0) return '()'
  if (dialect === 'postgres') {
    return `(${pgArgs(paramStart, count)})`
  }
  return `(${mysqlArgs(count)})`
}

// -- Inspect Mode Helpers --

/** Returns the InspectMode or its default for schema inspection. */
export function modeInspectSchema(opts?: InspectOptions): number {
  if (opts?.mode) return opts.mode
  return 0x7f // InspectAll
}

/** Returns the InspectMode or its default for realm inspection. */
export function modeInspectRealm(opts?: InspectRealmOption): number {
  if (opts?.mode) return opts.mode
  return 0x7f // InspectAll
}

// -- DiffDriver Interface --

/**
 * DiffDriver wraps all required methods for diffing elements that may
 * have database-specific diff logic. Each dialect (postgres, mysql, sqlite)
 * implements this interface.
 */
export interface DiffDriver {
  /** Returns a changeset for migrating schema attributes from one state to the other. */
  schemaAttrDiff(from: Schema, to: Schema): Change[]
  /** Returns a changeset for migrating schema objects from one state to the other. */
  schemaObjectDiff(from: Schema, to: Schema, opts?: DiffOptions): Change[]
  /** Returns a changeset for migrating realm objects from one state to the other. */
  realmObjectDiff(from: Realm, to: Realm, opts?: DiffOptions): Change[]
  /** Returns a changeset for migrating table attributes from one state to the other. */
  tableAttrDiff(from: Table, to: Table, opts?: DiffOptions): Change[]
  /** Returns the changes between two view attributes. */
  viewAttrChanges(from: View, to: View): Change[]
  /** Returns the schema change (if any) for migrating one column to the other. */
  columnChange(fromTable: Table, from: Column, to: Column, opts?: DiffOptions): Change | undefined
  /** Reports if the index attributes were changed. */
  indexAttrChanged(from: Attr[], to: Attr[]): boolean
  /** Reports if the index-part attributes at position i were changed. */
  indexPartAttrChanged(from: Index, to: Index, i: number): boolean
  /** Reports if the index name was generated by the database for unnamed constraints. */
  isGeneratedIndexName(table: Table, index: Index): boolean
  /** Reports if the foreign key referential action was changed. */
  referenceChanged(from: string | undefined, to: string | undefined): boolean
  /** Reports if any of the foreign-key attributes were changed. */
  foreignKeyAttrChanged(from: Attr[], to: Attr[]): boolean
  /** Reports if the column is a generated/virtual column. */
  isGeneratedColumn(col: Column): boolean
  /** Normalize a table before diffing. */
  normalize(table: Table): void
}

// -- SQL Builder --

/**
 * A Builder provides a syntactic sugar API for writing SQL statements.
 * Port of the Go sqlx.Builder.
 */
export class Builder {
  private buf = ''
  quoteOpening: string
  quoteClosing: string
  schema?: string
  indent: string
  private level = 0

  constructor(opts?: { quoteOpening?: string; quoteClosing?: string; schema?: string; indent?: string }) {
    this.quoteOpening = opts?.quoteOpening ?? '"'
    this.quoteClosing = opts?.quoteClosing ?? '"'
    this.schema = opts?.schema
    this.indent = opts?.indent ?? ''
  }

  /** Write phrases separated by whitespace. */
  P(...phrases: string[]): this {
    for (const p of phrases) {
      if (p === '') continue
      if (this.buf.length > 0) {
        const last = this.lastByte()
        if (last !== ' ' && last !== '(' && last !== '\n') {
          this.buf += ' '
        }
      }
      this.buf += p
      if (p[p.length - 1] !== ' ') {
        this.buf += ' '
      }
    }
    return this
  }

  /** Write a number. */
  Int(v: number | bigint): this {
    return this.P(String(v))
  }

  /** Write a quoted identifier. */
  Ident(s: string): this {
    if (s !== '') {
      const escaped = s.replaceAll(this.quoteClosing, this.quoteClosing + this.quoteClosing)
      this.buf += `${this.quoteOpening}${escaped}${this.quoteClosing} `
    }
    return this
  }

  /** Write a table identifier, prefixed with schema name if exists. */
  Table(t: { name: string; schema?: string }): this {
    return this.mayQualify(t.schema, t.name)
  }

  /** Write a view identifier, prefixed with schema name if exists. */
  View(v: { name: string; schema?: string }): this {
    return this.mayQualify(v.schema, v.name)
  }

  /** Write a function identifier. */
  Func(f: { name: string; schema?: string }): this {
    return this.mayQualify(f.schema, f.name)
  }

  /** Write schema-qualified identifier. */
  SchemaResource(schemaName: string | undefined, name: string): this {
    return this.mayQualify(schemaName, name)
  }

  private mayQualify(schemaName: string | undefined, top: string, ...children: string[]): this {
    if (this.schema !== undefined) {
      if (this.schema === '') {
        // Empty qualifier: strip all schema prefixes.
      } else if (schemaName && schemaName !== '' && schemaName !== this.schema) {
        this.Ident(schemaName)
        this.rewriteLastByte('.')
      }
    } else if (schemaName && schemaName !== '') {
      this.Ident(schemaName)
      this.rewriteLastByte('.')
    }
    this.Ident(top)
    for (const ident of children) {
      this.rewriteLastByte('.')
      this.Ident(ident)
    }
    return this
  }

  /** Increase indentation level. */
  IndentIn(): this {
    this.level++
    return this
  }

  /** Decrease indentation level. */
  IndentOut(): this {
    this.level--
    return this
  }

  /** Add line break with indentation. */
  NL(): this {
    if (this.indent !== '') {
      if (this.lastByte() === ' ') {
        this.rewriteLastByte('\n')
      } else {
        this.buf += '\n'
      }
      this.buf += this.indent.repeat(this.level)
    }
    return this
  }

  /** Write a comma separator. */
  Comma(): this {
    if (this.buf.length === 0) return this
    if (this.lastByte() === ' ') {
      this.rewriteLastByte(',')
      this.buf += ' '
    } else {
      this.buf += ', '
    }
    return this
  }

  /** Map over items with comma separation. */
  MapComma<T>(items: T[], fn: (item: T, i: number, b: Builder) => void): this {
    for (let i = 0; i < items.length; i++) {
      if (i > 0) this.Comma()
      fn(items[i], i, this)
    }
    return this
  }

  /** Map over items with indented newlines. */
  MapIndent<T>(items: T[], fn: (item: T, i: number, b: Builder) => void): this {
    return this.MapComma(items, (item, i, b) => {
      b.NL()
      fn(item, i, b)
    })
  }

  /** Wrap content in parentheses. */
  Wrap(fn: (b: Builder) => void): this {
    this.buf += '('
    fn(this)
    if (this.lastByte() !== ' ') {
      this.buf += ')'
    } else {
      this.rewriteLastByte(')')
    }
    return this
  }

  /** Wrap with indentation. */
  WrapIndent(fn: (b: Builder) => void): this {
    return this.Wrap((b) => {
      b.IndentIn()
      fn(b)
      b.IndentOut()
      b.NL()
    })
  }

  /** Clone this builder. */
  clone(): Builder {
    const b = new Builder({
      quoteOpening: this.quoteOpening,
      quoteClosing: this.quoteClosing,
      schema: this.schema,
      indent: this.indent,
    })
    b.buf = this.buf
    b.level = this.level
    return b
  }

  /** Get the trimmed result. */
  toString(): string {
    return this.buf.trim()
  }

  /** Get current buffer length. */
  get length(): number {
    return this.buf.length
  }

  /** Write raw string to buffer. */
  raw(s: string): this {
    this.buf += s
    return this
  }

  private lastByte(): string {
    if (this.buf.length === 0) return ''
    return this.buf[this.buf.length - 1]
  }

  private rewriteLastByte(c: string): void {
    if (this.buf.length === 0) return
    this.buf = this.buf.slice(0, -1) + c
  }
}

// -- String Utilities --

/** Reports if the given string is quoted with one of the given quotes. */
export function isQuoted(s: string, ...quotes: string[]): boolean {
  if (s.length < 2) return false
  for (const q of quotes) {
    if (s[0] !== q || s[s.length - 1] !== q) continue
    let valid = true
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i] === '\\') {
        i++
        continue
      }
      if (s[i] === q && s[i + 1] === q) {
        i++
        continue
      }
      if (s[i] === q) {
        valid = false
        break
      }
    }
    if (valid) return true
  }
  return false
}

/** Reports if the given string is a valid literal boolean. */
export function isLiteralBool(s: string): boolean {
  const l = s.toLowerCase()
  return l === 'true' || l === 'false' || l === '1' || l === '0'
}

/** Reports if the given string is a literal number. */
export function isLiteralNumber(s: string): boolean {
  if (s.startsWith('0x') || s.startsWith('0X')) {
    return /^[0-9a-fA-F]+$/.test(s.slice(2))
  }
  return !Number.isNaN(Number(s)) && s !== ''
}

/** Returns the default value string of a column. */
export function defaultValue(col: Column): string | undefined {
  if (!col.default) return undefined
  if ('X' in col.default) return col.default.X
  if ('V' in col.default) return col.default.V
  return undefined
}

/** Ensures the given string is wrapped with parentheses. */
export function mayWrap(s: string): string {
  if (s.length >= 2 && s[0] === '(' && s[s.length - 1] === ')') {
    return s
  }
  return `(${s})`
}

/** Reverses the order of changes in place. */
export function reverseChanges(changes: Change[]): void {
  changes.reverse()
}

/** Check if two string arrays are equal (including their order). */
export function valuesEqual(v1: string[], v2: string[]): boolean {
  if (v1.length !== v2.length) return false
  for (let i = 0; i < v1.length; i++) {
    if (v1[i] !== v2[i]) return false
  }
  return true
}

/** Reports whether the string represents an unsigned integer. */
export function isUint(s: string): boolean {
  if (s.length === 0) return false
  for (const ch of s) {
    if (ch < '0' || ch > '9') return false
  }
  return true
}

/** Check if two schemas are the same (by name). */
export function sameSchema(a: Schema | undefined, b: Schema | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.name === b.name
}
