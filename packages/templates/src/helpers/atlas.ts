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

/** Get the column type string, falling back to 'unknown' */
export function getColumnType(column: Column): string {
  return column.type.raw ?? column.type.type.T ?? 'unknown'
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
