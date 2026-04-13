// ── Schema snapshot types ───────────────────────────────────────────

export interface SchemaSnapshot {
  schemas: SchemaEntry[]
}

export interface SchemaEntry {
  name: string
  tables?: SchemaTable[]
  views?: SchemaView[]
  comment?: string
}

export interface SchemaTable {
  name: string
  columns: SchemaColumn[]
  indexes?: SchemaIndex[]
  primary_key?: SchemaPrimaryKey
  foreign_keys?: SchemaForeignKey[]
  checks?: SchemaCheck[]
}

export interface SchemaColumn {
  name: string
  type: string
  null?: boolean
  default?: string
}

export interface SchemaIndex {
  name: string
  unique?: boolean
  parts: Array<{ column: string }>
}

export interface SchemaPrimaryKey {
  parts: Array<{ column: string }>
}

export interface SchemaForeignKey {
  name: string
  columns: string[]
  references: {
    table: string
    columns: string[]
  }
}

export interface SchemaCheck {
  name: string
  expr: string
}

export interface SchemaView {
  name: string
  columns: SchemaColumn[]
  definition?: string
}

// ── Merged schema types (schema snapshot + sqldoc tags combined) ────

export interface DocsRelationship {
  from: string
  to: string
  label: string
  style?: 'dashed'
}

export interface DocsAnnotation {
  object: string
  text: string
}

export interface DocsColumnEntry {
  header: string
  object: string
  column?: string
  value: string
}

export interface MergedSchema {
  title: string
  generatedAt: string
  tables: MergedTable[]
  views: MergedView[]
  mermaidERD: string
  /** Extra relationships from plugins (e.g. audit trail arrows) */
  extraRelationships: DocsRelationship[]
  /** Table-level annotations from plugins (e.g. "RLS enabled") */
  annotations: DocsAnnotation[]
  /** Extra column headers contributed by plugins (appear on all tables) */
  extraColumnHeaders: string[]
  /** Extra column cell data from plugins, keyed by "table:column:header" */
  extraColumnData: Map<string, string>
}

export interface MergedTable {
  name: string
  description?: string
  /** Previous name if this table was renamed via @docs.previously */
  previously?: string
  isGenerated: boolean
  generatedBy?: string
  columns: MergedColumn[]
  indexes: SchemaIndex[]
  primaryKey?: SchemaPrimaryKey
  foreignKeys: SchemaForeignKey[]
  tags: MergedTag[]
}

export interface MergedColumn {
  name: string
  type: string
  nullable: boolean
  description?: string
  /** Previous name if this column was renamed via @docs.previously */
  previously?: string
  isPrimaryKey: boolean
  isForeignKey: boolean
  tags: MergedTag[]
}

export interface MergedTag {
  namespace: string
  tag: string | null
  args: Record<string, unknown> | unknown[]
}

export interface MergedView {
  name: string
  description?: string
  columns: MergedColumn[]
  tags: MergedTag[]
}

// ── Plugin config ───────────────────────────────────────────────────

export interface DocsConfig {
  /** Output file path (e.g. 'docs/schema.html') */
  output: string
  /** Output format */
  format: 'markdown' | 'html'
  /** Documentation title */
  title?: string
}
