import type { Column, ForeignKey, Realm, Table } from './schema.ts'

export function getSchemaTable(ctx: { schemaTable?: Table }): Table | undefined {
  return ctx.schemaTable
}

export function getSchemaRealm(ctx: { schemaRealm?: Realm }): Realm | undefined {
  return ctx.schemaRealm
}

export function getSchemaColumns(table: Table | undefined): Column[] {
  return table?.columns ?? []
}

export function getSchemaTables(realm: Realm | undefined): Table[] {
  if (!realm) return []
  return realm.schemas.flatMap((schema) => schema.tables ?? [])
}

export function getPrimaryKeyColumns(table: Table | undefined): string[] {
  return (table?.primaryKey?.parts ?? [])
    .map((part) => part.column)
    .filter((column): column is string => typeof column === 'string' && column.length > 0)
}

export function getForeignKeys(table: Table | undefined): ForeignKey[] {
  return table?.foreignKeys ?? []
}
