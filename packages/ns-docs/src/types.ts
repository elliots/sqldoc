// ── Atlas CLI JSON output types ─────────────────────────────────────

export interface AtlasSchema {
  schemas: AtlasSchemaEntry[]
}

export interface AtlasSchemaEntry {
  name: string
  tables?: AtlasTable[]
  views?: AtlasView[]
  comment?: string
}

export interface AtlasTable {
  name: string
  columns: AtlasColumn[]
  indexes?: AtlasIndex[]
  primary_key?: AtlasPrimaryKey
  foreign_keys?: AtlasForeignKey[]
  checks?: AtlasCheck[]
}

export interface AtlasColumn {
  name: string
  type: string
  null?: boolean
  default?: string
}

export interface AtlasIndex {
  name: string
  unique?: boolean
  parts: Array<{ column: string }>
}

export interface AtlasPrimaryKey {
  parts: Array<{ column: string }>
}

export interface AtlasForeignKey {
  name: string
  columns: string[]
  references: {
    table: string
    columns: string[]
  }
}

export interface AtlasCheck {
  name: string
  expr: string
}

export interface AtlasView {
  name: string
  columns: AtlasColumn[]
  definition?: string
}

// ── Merged schema types (Atlas + sqldoc tags combined) ──────────────

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
  indexes: AtlasIndex[]
  primaryKey?: AtlasPrimaryKey
  foreignKeys: AtlasForeignKey[]
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
