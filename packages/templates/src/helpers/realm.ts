import type { Column, Realm, Table, View } from '@sqldoc/db'

/** Table with schema origin preserved */
export interface SchemaTable extends Table {
  _schema: string
}

/** View with schema origin preserved */
export interface SchemaView extends View {
  _schema: string
}

/** Extract all tables from all schemas in a realm, preserving schema origin */
export function getTablesFromRealm(realm: Realm): SchemaTable[] {
  return realm.schemas.flatMap((s) => (s.tables ?? []).map((t) => ({ ...t, _schema: s.name })))
}

/** Extract all views from all schemas in a realm, preserving schema origin */
export function getViewsFromRealm(realm: Realm): SchemaView[] {
  return realm.schemas.flatMap((s) => (s.views ?? []).map((v) => ({ ...v, _schema: s.name })))
}

/** Check if a column is nullable */
export function isNullable(column: Column): boolean {
  return column.type.null === true
}

/** Get the column type string with precision/size, falling back to 'unknown' */
export function getColumnType(column: Column): string {
  const t = column.type.type

  // For arrays, use T (e.g. "text[]") not raw ("ARRAY")
  if (t.kind === 'array') return t.T ?? 'unknown'

  // For composites/domains/enums, use T (e.g. "address") not raw ("USER-DEFINED" or "public.address")
  if (t.kind === 'composite' || t.kind === 'domain' || t.kind === 'enum') return t.T ?? 'unknown'

  const raw = column.type.raw ?? t.T ?? 'unknown'

  // Append size/precision to produce full type string (e.g. "character varying(100)")
  if (t.kind === 'string' && 'size' in t && (t as any).size > 0) {
    return `${raw}(${(t as any).size})`
  }
  if (t.kind === 'decimal' && 'precision' in t && (t as any).precision > 0) {
    const scale = (t as any).scale ?? 0
    return scale > 0 ? `${raw}(${(t as any).precision},${scale})` : `${raw}(${(t as any).precision})`
  }
  return raw
}

/** Find all codegen tags for a given SQL object from allFileTags */
export function findTagsForObject(
  allFileTags: Array<{
    sourceFile: string
    objects: Array<{
      objectName: string
      target: string
      tags: Array<{ namespace: string; tag: string | null; args: Record<string, unknown> | unknown[] }>
    }>
  }>,
  objectName: string,
): Array<{ namespace: string; tag: string | null; args: Record<string, unknown> | unknown[] }> {
  for (const file of allFileTags) {
    for (const obj of file.objects) {
      if (obj.objectName === objectName) {
        return obj.tags
      }
    }
  }
  return []
}
