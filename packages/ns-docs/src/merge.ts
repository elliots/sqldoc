import type { CompilerOutput, DocsMeta, SqlTarget } from '@sqldoc/core'
import type {
  DocsAnnotation,
  DocsColumnEntry,
  DocsRelationship,
  MergedColumn,
  MergedSchema,
  MergedTable,
  MergedTag,
  MergedView,
  SchemaSnapshot,
  SchemaTable,
} from './types.ts'

interface FileTagData {
  sourceFile: string
  objects: Array<{
    objectName: string
    target: SqlTarget
    tags: Array<{
      namespace: string
      tag: string | null
      args: Record<string, unknown> | unknown[]
    }>
  }>
}

/** Normalize SQL identifier for matching: lowercase, strip surrounding quotes */
function normalizeName(name: string): string {
  const stripped = name.replace(/^["']|["']$/g, '')
  return stripped.toLowerCase()
}

/** Check if an object has docs.emit(false) */
function isExcluded(tags: MergedTag[]): boolean {
  return tags.some((t) => t.namespace === 'docs' && t.tag === 'emit' && (t.args as unknown[])[0] === false)
}

/** Extract docs.description value from tags */
function getDescription(tags: MergedTag[]): string | undefined {
  const descTag = tags.find((t) => t.namespace === 'docs' && t.tag === 'description')
  if (!descTag) return undefined
  return (descTag.args as unknown[])[0] as string | undefined
}

/** Extract docs.previously value from tags */
function getPreviously(tags: MergedTag[]): string | undefined {
  const prevTag = tags.find((t) => t.namespace === 'docs' && t.tag === 'previously')
  if (!prevTag) return undefined
  return (prevTag.args as unknown[])[0] as string | undefined
}

/** Build a set of generated table names from compiler outputs */
function buildGeneratedSet(outputs: CompilerOutput[]): Map<string, string> {
  const generated = new Map<string, string>()
  for (const output of outputs) {
    for (const sqlOut of output.sqlOutputs) {
      const tableName = extractCreateTableName(sqlOut.sql)
      if (tableName) {
        const ns = extractNamespace(sqlOut.sourceTag)
        generated.set(normalizeName(tableName), ns)
      }
    }
  }
  return generated
}

/**
 * Extract the table name from a CREATE TABLE statement.
 * Handles: CREATE TABLE name, CREATE TABLE "name", CREATE TABLE `name`,
 * CREATE TABLE IF NOT EXISTS name, CREATE TABLE schema.name,
 * CREATE TABLE "schema"."name"
 */
function extractCreateTableName(sql: string): string | undefined {
  const match = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:["'`]?\w+["'`]?)\.)?["'`]?(\w+)["'`]?/i)
  return match?.[1]
}

/** Extract namespace from a sourceTag like "@audit.track(args)" */
function extractNamespace(sourceTag: string | undefined): string {
  if (!sourceTag) return 'unknown'
  const match = sourceTag.match(/^@(\w+)/)
  return match?.[1] ?? 'unknown'
}

/** Build tag lookup: normalized objectName -> entries with target and tags */
function buildTagMap(allFileTags: FileTagData[]): Map<string, { target: SqlTarget; tags: MergedTag[] }[]> {
  const map = new Map<string, { target: SqlTarget; tags: MergedTag[] }[]>()
  for (const file of allFileTags) {
    for (const obj of file.objects) {
      const key = normalizeName(obj.objectName)
      const existing = map.get(key) ?? []
      existing.push({
        target: obj.target,
        tags: obj.tags.map((t) => ({
          namespace: t.namespace,
          tag: t.tag,
          args: t.args,
        })),
      })
      map.set(key, existing)
    }
  }
  return map
}

/** Get all tags for an object by normalized name (flatten across files, table/view level only) */
function getObjectTags(tagMap: Map<string, { target: SqlTarget; tags: MergedTag[] }[]>, name: string): MergedTag[] {
  const entries = tagMap.get(normalizeName(name)) ?? []
  return entries.filter((e) => e.target !== 'column').flatMap((e) => e.tags)
}

/** Get column-level tags — checks both "column" and "table.column" keys */
function getColumnTags(
  tagMap: Map<string, { target: SqlTarget; tags: MergedTag[] }[]>,
  columnName: string,
  tableName?: string,
): MergedTag[] {
  // Try table.column first (inspector convention), then bare column name
  const keys = tableName
    ? [normalizeName(`${tableName}.${columnName}`), normalizeName(columnName)]
    : [normalizeName(columnName)]

  for (const key of keys) {
    const entries = tagMap.get(key) ?? []
    const tags = entries.filter((e) => e.target === 'column').flatMap((e) => e.tags)
    if (tags.length > 0) return tags
  }
  return []
}

function mergeTable(
  table: SchemaTable,
  tagMap: Map<string, { target: SqlTarget; tags: MergedTag[] }[]>,
  generatedSet: Map<string, string>,
): MergedTable | null {
  const tableTags = getObjectTags(tagMap, table.name)
  if (isExcluded(tableTags)) return null

  const pkColumns = new Set((table.primary_key?.parts ?? []).map((p) => normalizeName(p.column)))
  const fkColumns = new Set((table.foreign_keys ?? []).flatMap((fk) => fk.columns.map((c) => normalizeName(c))))

  const columns: MergedColumn[] = table.columns.map((col) => {
    const colTags = getColumnTags(tagMap, col.name, table.name)
    return {
      name: col.name,
      type: col.type,
      nullable: col.null === true,
      description: getDescription(colTags),
      previously: getPreviously(colTags),
      isPrimaryKey: pkColumns.has(normalizeName(col.name)),
      isForeignKey: fkColumns.has(normalizeName(col.name)),
      tags: colTags,
    }
  })

  const normalizedName = normalizeName(table.name)
  const generatedBy = generatedSet.get(normalizedName)

  return {
    name: table.name,
    description: getDescription(tableTags),
    previously: getPreviously(tableTags),
    isGenerated: !!generatedBy,
    generatedBy,
    columns,
    indexes: table.indexes ?? [],
    primaryKey: table.primary_key,
    foreignKeys: table.foreign_keys ?? [],
    tags: tableTags,
  }
}

export function mergeSchemaWithTags(
  schema: SchemaSnapshot,
  mermaid: string,
  allFileTags: FileTagData[],
  outputs: CompilerOutput[],
  title: string,
  docsMeta: DocsMeta[] = [],
): MergedSchema {
  const tagMap = buildTagMap(allFileTags)
  const generatedSet = buildGeneratedSet(outputs)

  const tables: MergedTable[] = []
  const views: MergedView[] = []

  for (const s of schema.schemas) {
    for (const table of s.tables ?? []) {
      const merged = mergeTable(table, tagMap, generatedSet)
      if (merged) tables.push(merged)
    }
    for (const view of s.views ?? []) {
      const viewTags = getObjectTags(tagMap, view.name)
      if (isExcluded(viewTags)) continue
      views.push({
        name: view.name,
        description: getDescription(viewTags),
        columns: view.columns.map((col) => ({
          name: col.name,
          type: col.type,
          nullable: col.null === true,
          isPrimaryKey: false,
          isForeignKey: false,
          tags: [],
        })),
        tags: viewTags,
      })
    }
  }

  // Aggregate docs metadata from plugins
  const extraRelationships: DocsRelationship[] = docsMeta.flatMap((d) => d.relationships ?? [])
  const annotations: DocsAnnotation[] = docsMeta.flatMap((d) => d.annotations ?? [])

  // Collect extra column headers and data
  const allColumnEntries: DocsColumnEntry[] = docsMeta.flatMap((d) => d.columns ?? [])
  const headerSet = new Set<string>()
  const extraColumnData = new Map<string, string>()
  for (const entry of allColumnEntries) {
    headerSet.add(entry.header)
    const key = entry.column
      ? `${entry.object.toLowerCase()}:${entry.column.toLowerCase()}:${entry.header}`
      : `${entry.object.toLowerCase()}::${entry.header}`
    // Append if multiple values for same cell
    const existing = extraColumnData.get(key)
    extraColumnData.set(key, existing ? `${existing}, ${entry.value}` : entry.value)
  }
  const extraColumnHeaders = [...headerSet]

  return {
    title,
    generatedAt: new Date().toISOString(),
    tables,
    views,
    mermaidERD: mermaid,
    extraRelationships,
    annotations,
    extraColumnHeaders,
    extraColumnData,
  }
}
