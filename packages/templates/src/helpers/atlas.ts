import type { AtlasColumn, AtlasRealm, AtlasTable, AtlasView } from '@sqldoc/db'

/** Extract all tables from all schemas in a realm */
export function getTablesFromRealm(realm: AtlasRealm): AtlasTable[] {
  return realm.schemas.flatMap((s) => s.tables ?? [])
}

/** Extract all views from all schemas in a realm */
export function getViewsFromRealm(realm: AtlasRealm): AtlasView[] {
  return realm.schemas.flatMap((s) => s.views ?? [])
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
