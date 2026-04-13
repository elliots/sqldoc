export interface SchemaTypeLike {
  T?: string
  raw?: string
  null?: boolean
  type?: {
    T?: string
  }
}

export interface SchemaColumnLike {
  name: string
  type?: SchemaTypeLike
}

export interface SchemaPrimaryKeyLike {
  columns?: string[]
  parts?: Array<{ column?: string }>
}

export interface SchemaForeignKeyLike {
  name?: string
  symbol?: string
  columns?: string[]
  refTable?: string
  ref_table?: string
  refColumns?: string[]
  ref_columns?: string[]
}

export interface SchemaTableLike {
  name: string
  columns?: SchemaColumnLike[]
  primaryKey?: SchemaPrimaryKeyLike
  primary_key?: SchemaPrimaryKeyLike
  foreignKeys?: SchemaForeignKeyLike[]
  foreign_keys?: SchemaForeignKeyLike[]
}

export interface SchemaLike {
  name: string
  tables?: SchemaTableLike[]
}

export interface SchemaRealmLike {
  schemas: SchemaLike[]
}

export interface NormalizedForeignKey {
  name?: string
  columns: string[]
  refColumns: string[]
  refTable?: string
}

function asObject<T>(value: unknown): T | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as T
}

export function getSchemaTable(ctx: { schemaTable?: unknown }): SchemaTableLike | undefined {
  return asObject<SchemaTableLike>(ctx.schemaTable)
}

export function getSchemaRealm(ctx: { schemaRealm?: unknown }): SchemaRealmLike | undefined {
  return asObject<SchemaRealmLike>(ctx.schemaRealm)
}

export function getSchemaColumns(table: SchemaTableLike | undefined): SchemaColumnLike[] {
  return table?.columns ?? []
}

export function getSchemaTables(realm: SchemaRealmLike | undefined): SchemaTableLike[] {
  if (!realm) return []
  return realm.schemas.flatMap((schema) => schema.tables ?? [])
}

export function getPrimaryKeyColumns(table: SchemaTableLike | undefined): string[] {
  const primaryKey = table?.primaryKey ?? table?.primary_key
  if (!primaryKey) return []
  if (primaryKey.columns && primaryKey.columns.length > 0) {
    return primaryKey.columns.filter(Boolean)
  }
  return (primaryKey.parts ?? []).map((part) => part.column).filter((column): column is string => Boolean(column))
}

export function getForeignKeys(table: SchemaTableLike | undefined): NormalizedForeignKey[] {
  const foreignKeys = table?.foreignKeys ?? table?.foreign_keys ?? []
  return foreignKeys.map((foreignKey) => ({
    name: foreignKey.symbol ?? foreignKey.name,
    columns: foreignKey.columns ?? [],
    refColumns: foreignKey.refColumns ?? foreignKey.ref_columns ?? [],
    refTable: foreignKey.refTable ?? foreignKey.ref_table,
  }))
}
