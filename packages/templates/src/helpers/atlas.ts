import type { AtlasColumn, AtlasRealm, AtlasTable, AtlasView } from '@sqldoc/db'

/** AtlasTable with schema origin preserved */
export interface SchemaTable extends AtlasTable {
  _schema: string
}

/** AtlasView with schema origin preserved */
export interface SchemaView extends AtlasView {
  _schema: string
}

/** Extract all tables from all schemas in a realm, preserving schema origin */
export function getTablesFromRealm(realm: AtlasRealm): SchemaTable[] {
  return realm.schemas.flatMap((s) => (s.tables ?? []).map((t) => ({ ...t, _schema: s.name })))
}

/** Extract all views from all schemas in a realm, preserving schema origin */
export function getViewsFromRealm(realm: AtlasRealm): SchemaView[] {
  return realm.schemas.flatMap((s) => (s.views ?? []).map((v) => ({ ...v, _schema: s.name })))
}

/** Check if a column is nullable */
export function isNullable(column: AtlasColumn): boolean {
  return column.type?.null === true
}

/** Get the column type string, falling back to 'unknown' */
export function getColumnType(column: AtlasColumn): string {
  return column.type?.T ?? column.type?.raw ?? 'unknown'
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
