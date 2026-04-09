// ── Atlas WASI command/result types ─────────────────────────────────
// Hand-crafted from atlas/cmd/atlas-wasi/marshal.go (cycle-free flat types).
// Schema fields use lowercase json tags from the flat marshaler.
// Attr variants (Tag, Comment, Check) use PascalCase from map[string]string.

/**
 * A known rename (from @docs.previously tags) to pass to Atlas before diffing.
 */
export interface AtlasRename {
  type: 'column' | 'table'
  table: string
  oldName: string
  newName: string
}

/**
 * A potential rename detected by Atlas during diff (drop+add pair with same type).
 */
export interface AtlasRenameCandidate {
  type: 'column' | 'table'
  table: string
  oldName: string
  newName: string
  colType?: string
}

/**
 * Command sent to Atlas WASI module via stdin.
 */
export interface AtlasCommand {
  type: 'inspect' | 'diff' | 'apply'
  dialect: 'postgres' | 'mysql' | 'sqlite'
  schema?: string
  defaultSchema?: string
  files?: string[]
  fileNames?: string[]
  from?: string[]
  to?: string[]
  fromConnection?: string
  toConnection?: string
  renames?: AtlasRename[]
}

/**
 * A structured schema change description returned from Atlas diff.
 */
export interface AtlasChange {
  type:
    | 'add_table'
    | 'drop_table'
    | 'rename_table'
    | 'add_column'
    | 'drop_column'
    | 'rename_column'
    | 'modify_column'
    | 'add_index'
    | 'drop_index'
    | 'add_view'
    | 'drop_view'
    | 'modify_view'
    | 'add_function'
    | 'drop_function'
    | 'modify_function'
  table: string
  name?: string
  detail?: string
}

/**
 * Result returned from Atlas WASI module via stdout.
 * Top-level fields use lowercase json tags.
 */
export interface AtlasResult {
  schema?: AtlasRealm
  statements?: string[]
  changes?: AtlasChange[]
  renameCandidates?: AtlasRenameCandidate[]
  error?: string
}

// ── Schema types — lowercase (json tags in marshal.go flat types) ───

/**
 * A Realm describes a domain of schema resources (physical database instance).
 * Maps to flatRealm in marshal.go.
 */
export interface AtlasRealm {
  schemas: AtlasSchema[]
  attrs?: AtlasAttr[]
}

/**
 * A Schema describes a named database schema (e.g. "public").
 * Maps to flatSchema in marshal.go.
 */
export interface AtlasSchema {
  name: string
  tables?: AtlasTable[]
  views?: AtlasView[]
  funcs?: AtlasFunc[]
  procs?: AtlasProc[]
  composite_types?: AtlasCompositeType[]
  attrs?: AtlasAttr[]
}

export interface AtlasCompositeType {
  name: string
  fields: Array<{ name: string; type: string }>
}

/**
 * A Table represents a table definition.
 * Maps to flatTable in marshal.go.
 */
export interface AtlasTable {
  name: string
  columns?: AtlasColumn[]
  indexes?: AtlasIndex[]
  primary_key?: AtlasIndex
  foreign_keys?: AtlasForeignKey[]
  attrs?: AtlasAttr[]
  triggers?: AtlasTrigger[]
}

/**
 * A Column represents a column definition.
 * Maps to flatColumn in marshal.go.
 */
export interface AtlasColumn {
  /** Column name. Omitted for unnamed expressions (e.g. SELECT 1 in a view). */
  name?: string
  type?: AtlasColumnType
  default?: AtlasExpr
  attrs?: AtlasAttr[]
}

/**
 * ColumnType represents a column type.
 * Maps to flatColumnType in marshal.go.
 * The `T` field is the type name (e.g., "bigint", "text").
 */
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

export interface AtlasColumnType {
  T?: string
  raw?: string
  null?: boolean
  /** Normalized type category — dialect-independent */
  category?: TypeCategory
  /** Whether this is a user-defined type (enum, composite, domain) */
  is_custom?: boolean
  /** Enum values (when category is 'enum') */
  enum_values?: string[]
  /** Composite type fields (when category is 'composite') */
  composite_fields?: Array<{ name: string; type: string }>
}

/**
 * An Index represents an index definition.
 * Maps to flatIndex in marshal.go.
 */
export interface AtlasIndex {
  name?: string
  unique?: boolean
  parts?: AtlasIndexPart[]
  attrs?: AtlasAttr[]
}

/**
 * An IndexPart represents a single part of an index.
 * Maps to flatIndexPart in marshal.go.
 */
export interface AtlasIndexPart {
  column?: string
  desc?: boolean
  attrs?: AtlasAttr[]
}

/**
 * A ForeignKey represents a foreign key constraint.
 * Maps to flatForeignKey in marshal.go.
 */
export interface AtlasForeignKey {
  symbol?: string
  columns?: string[]
  ref_columns?: string[]
  ref_table?: string
  on_update?: string
  on_delete?: string
}

/**
 * A View represents a view definition.
 * Maps to flatView in marshal.go.
 */
export interface AtlasView {
  name: string
  def?: string
  columns?: AtlasColumn[]
  attrs?: AtlasAttr[]
}

/**
 * A Func represents a function definition.
 * Maps to flatFunc in marshal.go.
 */
export interface AtlasFunc {
  name: string
  args?: AtlasFuncArg[]
  ret?: AtlasColumnType
  lang?: string
  attrs?: AtlasAttr[]
}

export interface AtlasFuncArg {
  name?: string
  type?: AtlasColumnType
  mode?: string
}

/**
 * A Proc represents a procedure definition.
 * Maps to flatProc in marshal.go.
 */
export interface AtlasProc {
  name: string
  attrs?: AtlasAttr[]
}

/**
 * A Trigger represents a trigger definition.
 * Maps to flatTrigger in marshal.go.
 */
export interface AtlasTrigger {
  name: string
  attrs?: AtlasAttr[]
}

/**
 * An expression in schema DDL.
 * Go serializes RawExpr as { X: string }, Literal as { V: string }.
 */
export type AtlasExpr = { X: string } | { V: string } | unknown

// ── Attr union — PascalCase (map[string]string in Go marshal) ───────

/**
 * Attrs is a heterogeneous array (Tag, Comment, Check all mixed).
 * We model the known variants as a discriminated union with a fallback.
 * Note: Attr fields use PascalCase (serialized via map[string]string in Go).
 */
export type AtlasAttr = AtlasTag | AtlasComment | AtlasCheck | Record<string, unknown>

/**
 * Tag attr. Serialized as { Name: string, Args: string }.
 * PascalCase because Go marshal uses map[string]string{"Name": ..., "Args": ...}.
 */
export interface AtlasTag {
  Name: string
  Args: string
}

/**
 * Comment attr. Serialized as { Text: string }.
 */
export interface AtlasComment {
  Text: string
}

/**
 * Check constraint attr. Serialized as { Name?: string, Expr: string }.
 */
export interface AtlasCheck {
  Name?: string
  Expr: string
}

// ── Helper functions ────────────────────────────────────────────────

/**
 * Type guard: returns true if the given attr is a Tag.
 * Tags have `Name` and `Args` fields but NOT an `Expr` field
 * (which would indicate a Check constraint instead).
 */
export function isTag(attr: AtlasAttr): attr is AtlasTag {
  return (
    typeof attr === 'object' &&
    attr !== null &&
    'Name' in attr &&
    typeof (attr as AtlasTag).Name === 'string' &&
    'Args' in attr &&
    typeof (attr as AtlasTag).Args === 'string' &&
    !('Expr' in attr)
  )
}

/**
 * Extract all Tag attrs from a mixed Attrs array.
 * Returns an empty array if attrs is undefined or empty.
 */
export function findTags(attrs?: AtlasAttr[]): AtlasTag[] {
  if (!attrs) return []
  return attrs.filter(isTag)
}
