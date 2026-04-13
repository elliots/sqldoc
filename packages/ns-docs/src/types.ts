import type { ForeignKey, Index } from '@sqldoc/core'

// ── Merged schema types (canonical realm + sqldoc tags combined) ────

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
  indexes: Index[]
  primaryKey?: Index
  foreignKeys: ForeignKey[]
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
