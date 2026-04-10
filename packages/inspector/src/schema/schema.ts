// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/schema/schema.go

// -- Expressions --

/** A raw expression like "uuid()" or "current_timestamp()". */
export interface RawExpr {
  X: string
}

/** A basic literal expression like 1, or '1'. */
export interface Literal {
  V: string
}

/** An SQL expression in schema DDL. */
export type Expr = RawExpr | Literal

// -- Attributes --

/** A schema element comment. */
export interface Comment {
  kind: 'comment'
  text: string
}

/** A column or table collation setting. */
export interface Collation {
  kind: 'collation'
  V: string
}

/** A column or table character-set setting. */
export interface Charset {
  kind: 'charset'
  V: string
}

/** Expression used for generating the value of a generated/virtual column. */
export interface GeneratedExpr {
  kind: 'generated'
  expr: string
  /** Optional type, e.g. STORED or VIRTUAL. */
  type?: string
}

/** A sqldoc tag attribute. */
export interface Tag {
  kind: 'tag'
  name: string
  args: string
}

/** Union of all known attribute types, with a fallback for driver-specific attrs. */
export type Attr = Comment | Collation | Charset | GeneratedExpr | Tag | Record<string, unknown>

// -- Type Hierarchy (discriminated union with `kind` field) --

export interface StringType {
  kind: 'string'
  T: string
  size?: number
}

export interface IntegerType {
  kind: 'integer'
  T: string
  unsigned?: boolean
  attrs?: Attr[]
}

export interface FloatType {
  kind: 'float'
  T: string
  precision?: number
}

export interface DecimalType {
  kind: 'decimal'
  T: string
  precision?: number
  scale?: number
}

export interface BoolType {
  kind: 'boolean'
  T: string
}

export interface TimeType {
  kind: 'time'
  T: string
  precision?: number
}

export interface BinaryType {
  kind: 'binary'
  T: string
  size?: number
}

export interface JSONType {
  kind: 'json'
  T: string
}

export interface UUIDType {
  kind: 'uuid'
  T: string
}

export interface SpatialType {
  kind: 'spatial'
  T: string
}

export interface EnumType {
  kind: 'enum'
  T: string
  values: string[]
  schema?: string
}

export interface UnsupportedType {
  kind: 'unsupported'
  T: string
}

// -- PostgreSQL Advanced Types --

export interface ArrayType {
  kind: 'array'
  T: string
  type?: SchemaType
}

export interface CompositeType {
  kind: 'composite'
  T: string
  fields: Array<{ name: string; type: SchemaType }>
  schema?: string
}

export interface DomainType {
  kind: 'domain'
  T: string
  type: SchemaType
  schema?: string
  null?: boolean
  default?: Expr
  checks?: Check[]
  attrs?: Attr[]
}

export interface RangeType {
  kind: 'range'
  T: string
  schema?: string
}

export interface SerialType {
  kind: 'serial'
  T: string
  integerType?: IntegerType
}

export interface NetworkType {
  kind: 'network'
  T: string
}

export interface CurrencyType {
  kind: 'currency'
  T: string
}

export interface TextSearchType {
  kind: 'text_search'
  T: string
}

export interface IntervalType {
  kind: 'interval'
  T: string
  precision?: number
  fields?: string
}

/** Discriminated union of all schema types. */
export type SchemaType =
  | StringType
  | IntegerType
  | FloatType
  | DecimalType
  | BoolType
  | TimeType
  | BinaryType
  | JSONType
  | UUIDType
  | SpatialType
  | EnumType
  | UnsupportedType
  // PostgreSQL advanced types
  | ArrayType
  | CompositeType
  | DomainType
  | RangeType
  | SerialType
  | NetworkType
  | CurrencyType
  | TextSearchType
  | IntervalType
  | UnknownType
  | XMLType
  | OIDType
  | BitType

/** An unknown/user-defined type. */
export interface UnknownType {
  kind: 'unknown'
  T: string
  class?: string
}

/** An XML type. */
export interface XMLType {
  kind: 'xml'
  T: string
}

/** An OID type. */
export interface OIDType {
  kind: 'oid'
  T: string
}

/** A bit/varbit type. */
export interface BitType {
  kind: 'bit'
  T: string
  size?: number
}

// -- Column Type Wrapper --

/** Wraps a SchemaType with nullability and raw SQL string. */
export interface ColumnType {
  type: SchemaType
  null?: boolean
  raw?: string
}

// -- Object Reference (for Deps/Refs -- string reference to avoid circular refs) --

/**
 * A reference to a schema object by type and name.
 * Used for Deps/Refs tracking without circular back-pointers.
 */
export interface ObjectRef {
  type: 'table' | 'view' | 'func' | 'proc' | 'trigger' | 'sequence'
  name: string
  schema?: string
}

// -- Reference Actions --

/** Foreign key reference actions for ON UPDATE / ON DELETE. */
export type ReferenceAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT'

// -- Core Schema Objects --

/** A CHECK constraint. */
export interface Check {
  name?: string
  expr: string
  attrs?: Attr[]
}

/** A single part of an index (column or expression). */
export interface IndexPart {
  column?: string
  expr?: string
  desc?: boolean
  attrs?: Attr[]
}

/** An index definition. */
export interface Index {
  name?: string
  unique?: boolean
  parts: IndexPart[]
  attrs?: Attr[]
}

/** A foreign key constraint. */
export interface ForeignKey {
  symbol?: string
  columns: string[]
  refTable: string
  refSchema?: string
  refColumns: string[]
  onUpdate?: ReferenceAction
  onDelete?: ReferenceAction
  attrs?: Attr[]
}

/** A single function argument. */
export interface FuncArg {
  name?: string
  type: ColumnType
  mode?: string
  default?: Expr
}

/** A column definition. */
export interface Column {
  name: string
  type: ColumnType
  default?: Expr
  attrs?: Attr[]
}

// -- RLS Policy (Postgres-specific but in core types) --

/** A row-level security policy. */
export interface Policy {
  name: string
  /** Whether the policy is permissive (true) or restrictive (false). */
  permissive?: boolean
  /** Target roles for this policy. */
  roles?: string[]
  /** USING expression. */
  using?: string
  /** WITH CHECK expression. */
  check?: string
  /** Command type: ALL, SELECT, INSERT, UPDATE, DELETE. */
  cmd?: string
  attrs?: Attr[]
}

// -- Trigger --

/** A trigger definition. */
export interface Trigger {
  name: string
  table?: string
  events?: string[]
  timing?: string
  forEach?: string
  body?: string
  attrs?: Attr[]
  deps?: ObjectRef[]
  refs?: ObjectRef[]
}

// -- Sequence --

/** A sequence definition. */
export interface Sequence {
  name: string
  schema?: string
  type?: ColumnType
  start?: number | bigint
  increment?: number | bigint
  min?: number | bigint
  max?: number | bigint
  cache?: number | bigint
  cycle?: boolean
  attrs?: Attr[]
}

// -- Extended Objects --

/** A database extension (e.g. pg_trgm, uuid-ossp). */
export interface Extension {
  name: string
  version?: string
  schema?: string
  attrs?: Attr[]
}

/** An event trigger (PostgreSQL). */
export interface EventTrigger {
  name: string
  event: string
  tags?: string[]
  function?: string
  attrs?: Attr[]
}

/** An operator definition. */
export interface Operator {
  name: string
  schema?: string
  attrs?: Attr[]
}

/** A cast definition. */
export interface Cast {
  source: string
  target: string
  function?: string
  type?: string
  attrs?: Attr[]
}

// -- Functions and Procedures --

/** A function definition. */
export interface Func {
  name: string
  schema?: string
  args?: FuncArg[]
  ret?: ColumnType
  lang?: string
  body?: string
  attrs?: Attr[]
  deps?: ObjectRef[]
  refs?: ObjectRef[]
}

/** A procedure definition. */
export interface Proc {
  name: string
  schema?: string
  args?: FuncArg[]
  lang?: string
  body?: string
  attrs?: Attr[]
  deps?: ObjectRef[]
  refs?: ObjectRef[]
}

// -- View --

/** A view definition. */
export interface View {
  name: string
  schema?: string
  def?: string
  columns?: Column[]
  /** Whether this is a materialized view. */
  materialized?: boolean
  indexes?: Index[]
  attrs?: Attr[]
  deps?: ObjectRef[]
  refs?: ObjectRef[]
}

// -- Table --

/** A table definition. */
export interface Table {
  name: string
  schema?: string
  columns: Column[]
  indexes?: Index[]
  primaryKey?: Index
  foreignKeys?: ForeignKey[]
  checks?: Check[]
  triggers?: Trigger[]
  policies?: Policy[]
  attrs?: Attr[]
  deps?: ObjectRef[]
  refs?: ObjectRef[]
}

// -- Schema --

/** A database schema (e.g. "public"). */
export interface Schema {
  name: string
  tables?: Table[]
  views?: View[]
  funcs?: Func[]
  procs?: Proc[]
  triggers?: Trigger[]
  sequences?: Sequence[]
  enums?: EnumType[]
  compositeTypes?: CompositeType[]
  extensions?: Extension[]
  eventTriggers?: EventTrigger[]
  operators?: Operator[]
  casts?: Cast[]
  attrs?: Attr[]
  deps?: ObjectRef[]
  refs?: ObjectRef[]
}

// -- Realm --

/**
 * A Realm describes a domain of schema resources that are logically connected
 * and can be accessed and queried in the same connection (e.g. a physical database instance).
 *
 * NO back-pointer from Schema to Realm (decision D-09: avoid circular references).
 */
export interface Realm {
  schemas: Schema[]
  attrs?: Attr[]
}

// -- Type Category --

/** Dialect-independent type category for column types. */
export type TypeCategory =
  | 'string'
  | 'integer'
  | 'float'
  | 'decimal'
  | 'boolean'
  | 'time'
  | 'binary'
  | 'json'
  | 'uuid'
  | 'spatial'
  | 'enum'
  | 'composite'
  | 'array'
  | 'unknown'

// -- Rename Types --

/** A known rename to apply before diffing. */
export interface Rename {
  type: 'column' | 'table'
  table: string
  oldName: string
  newName: string
}

/** A potential rename detected during diff (drop+add pair with matching type). */
export interface RenameCandidate {
  type: 'column' | 'table'
  table: string
  oldName: string
  newName: string
  colType?: string
}
