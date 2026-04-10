/**
 * Enrichment layer — preprocesses inspector realm + tags into a rich,
 * template-friendly structure. Computed once, used by all templates.
 */
import type { Column, Table, TypeCategory } from '@sqldoc/db'
import { isCustomType, typeCategory } from '@sqldoc/db'
import type { TemplateContext } from '@sqldoc/ns-codegen'
import { findTagsForObject, getColumnType, getTablesFromRealm, getViewsFromRealm, isNullable } from './atlas.ts'
import { singularizeLast, toPascalCase } from './naming.ts'
import { findRename, findTypeOverride, isSkipped } from './tags.ts'

// ── Public types ─────────────────────────────────────────────────

export interface EnrichedSchema {
  tables: EnrichedTable[]
  views: EnrichedView[]
  enums: EnrichedEnum[]
  functions: EnrichedFunction[]
}

export interface EnrichedTable {
  /** Original SQL name */
  name: string
  /** PascalCase name (or @codegen.rename override), schema-prefixed in multi-schema realms */
  pascalName: string
  /** Schema this table belongs to */
  schema: string
  /** SQL-qualified name: "schema.table" in multi-schema, "table" in single-schema */
  sqlName: string
  /** Whether this table is skipped for the current template */
  skipped: boolean
  /** Column definitions */
  columns: EnrichedColumn[]
  /** Primary key column names */
  primaryKey: string[]
  /** FKs on this table pointing to other tables */
  belongsTo: Relation[]
  /** FKs on other tables pointing to this table */
  hasMany: Relation[]
  /** All tags on this table */
  tags: TagEntry[]
  /** Raw inspector table (escape hatch) */
  raw: Table
}

export interface EnrichedColumn {
  /** Original SQL name */
  name: string
  /** PascalCase name */
  pascalName: string
  /** camelCase name */
  camelName: string
  /** Raw SQL type string (e.g. "character varying", "bigserial") */
  pgType: string
  /** Dialect-independent type category */
  category: TypeCategory
  /** Whether this is a user-defined type (enum, composite, domain) */
  isCustomType: boolean
  /** Enum values (when category is 'enum') */
  enumValues?: string[]
  /** Composite type fields (when category is 'composite') */
  compositeFields?: Array<{ name: string; type: string }>
  /** Whether the column is nullable */
  nullable: boolean
  /** Whether this is a primary key column */
  isPrimaryKey: boolean
  /** Whether this is a serial/auto-increment column */
  isSerial: boolean
  /** Default value expression (if any) */
  defaultValue?: string
  /** FK reference (if this column is a foreign key) */
  foreignKey?: { table: string; column: string; schema: string }
  /** Type override from @codegen.type tag (if any) */
  typeOverride?: string
  /** All tags on this column */
  tags: TagEntry[]
  /** Raw inspector column (escape hatch) */
  raw: Column
}

export interface Relation {
  /** Constraint name */
  constraintName: string
  /** Column on the source table */
  column: string
  /** The other table */
  foreignTable: string
  /** Column on the other table */
  foreignColumn: string
  /** Schema of the foreign table */
  foreignSchema: string
}

export interface TagEntry {
  namespace: string
  tag: string | null
  args: Record<string, unknown> | unknown[]
}

export interface EnrichedView {
  /** Original SQL name */
  name: string
  /** PascalCase name */
  pascalName: string
  /** Schema this view belongs to */
  schema: string
  /** SQL-qualified name: "schema.view" in multi-schema, "view" in single-schema */
  sqlName: string
  /** Whether this view is skipped for the current template */
  skipped: boolean
  /** Column definitions (no PK, FK, or serial) */
  columns: EnrichedColumn[]
  /** All tags on this view */
  tags: TagEntry[]
}

export interface EnrichedEnum {
  /** Original SQL type name */
  name: string
  /** PascalCase name */
  pascalName: string
  /** Schema this enum belongs to */
  schema: string
  /** Enum variant values */
  values: string[]
}

export interface EnrichedFunction {
  /** Original SQL function name */
  name: string
  /** PascalCase name (schema-prefixed when multi-schema) */
  pascalName: string
  /** Schema this function belongs to */
  schema: string
  /** Function arguments */
  args: Array<{ name: string; type: string; category: string }>
  /** Return type */
  returnType?: { type: string; category: string; compositeFields?: Array<{ name: string; type: string }> }
  /** Language (sql, plpgsql, etc.) */
  language?: string
}

// ── Enrichment ───────────────────────────────────────────────────

/**
 * Enrich the raw inspector realm into a template-friendly structure.
 * Computes relationships, PK/FK lookups, tag indexing, naming, etc.
 *
 * Schema-aware: multi-schema realms get schema-prefixed pascalNames (e.g. AuthUser),
 * single-schema realms produce identical output to pre-multi-schema behavior.
 */
export function enrichRealm(ctx: TemplateContext<any>): EnrichedSchema {
  const rawTables = getTablesFromRealm(ctx.realm)

  // ── Schema detection ──────────────────────────────────────────
  const distinctSchemas = new Set(rawTables.map((t) => t._schema))
  const isMultiSchema = distinctSchemas.size > 1
  const stripSchema = ctx.stripSchemaFromName === true
  const defaultSchema = ctx.defaultSchema ?? ''

  // Build name-to-schemas lookup for FK schema resolution
  const tableNameToSchemas = new Map<string, string[]>()
  for (const t of rawTables) {
    const schemas = tableNameToSchemas.get(t.name) ?? []
    schemas.push(t._schema)
    tableNameToSchemas.set(t.name, schemas)
  }

  /** Resolve which schema a refTable belongs to */
  function resolveRefSchema(refTable: string, currentSchema: string): string {
    if (refTable.includes('.')) {
      return refTable.split('.')[0]
    }
    const schemas = tableNameToSchemas.get(refTable)
    if (!schemas || schemas.length === 0) return currentSchema
    if (schemas.length === 1) return schemas[0]
    return schemas.includes(currentSchema) ? currentSchema : schemas[0]
  }

  // Build reverse FK index: "schema.targetTable" -> relations pointing at it
  const reverseIndex = new Map<string, Relation[]>()
  for (const table of rawTables) {
    for (const fk of table.foreignKeys ?? []) {
      if (!fk.columns.length) continue
      const refSchema = resolveRefSchema(fk.refTable, table._schema)
      const refKey = `${refSchema}.${fk.refTable}`
      for (let i = 0; i < fk.columns.length; i++) {
        const rel: Relation = {
          constraintName: fk.symbol ?? '',
          column: fk.refColumns[i] ?? 'id',
          foreignTable: table.name,
          foreignColumn: fk.columns[i],
          foreignSchema: table._schema,
        }
        const existing = reverseIndex.get(refKey) ?? []
        existing.push(rel)
        reverseIndex.set(refKey, existing)
      }
    }
  }

  const tables: EnrichedTable[] = rawTables.map((table) => {
    const schema = table._schema
    const tableTags = findTagsForObject(ctx.allFileTags, table.name)
    const skipped = isSkipped(tableTags, ctx.templateName)

    // Compute pascalName with schema-awareness
    const rename = findRename(tableTags, ctx.templateName)
    let pascalName: string
    if (rename) {
      pascalName = rename
    } else {
      const baseName = toPascalCase(singularizeLast(table.name))
      if (isMultiSchema && !stripSchema && schema !== defaultSchema) {
        pascalName = toPascalCase(schema) + baseName
      } else {
        pascalName = baseName
      }
    }

    // Compute sqlName
    const sqlName = isMultiSchema && schema !== defaultSchema ? `${schema}.${table.name}` : table.name

    const pkColumns = new Set(
      (table.primaryKey?.parts ?? []).map((p) => p.column).filter((c): c is string => c != null),
    )

    // Build FK map for this table
    const fkMap = new Map<string, { table: string; column: string; schema: string }>()
    const belongsTo: Relation[] = []
    for (const fk of table.foreignKeys ?? []) {
      if (!fk.columns.length) continue
      const refSchema = resolveRefSchema(fk.refTable, schema)
      for (let i = 0; i < fk.columns.length; i++) {
        const ref = { table: fk.refTable, column: fk.refColumns[i] ?? 'id', schema: refSchema }
        fkMap.set(fk.columns[i], ref)
        belongsTo.push({
          constraintName: fk.symbol ?? '',
          column: fk.columns[i],
          foreignTable: fk.refTable,
          foreignColumn: ref.column,
          foreignSchema: refSchema,
        })
      }
    }

    const hasMany = reverseIndex.get(`${schema}.${table.name}`) ?? []

    const columns: EnrichedColumn[] = table.columns.map((col) =>
      enrichColumn(col, table.name, ctx.templateName, ctx.allFileTags, pkColumns, fkMap),
    )

    return {
      name: table.name,
      pascalName,
      schema,
      sqlName,
      skipped,
      columns,
      primaryKey: [...pkColumns],
      belongsTo,
      hasMany,
      tags: tableTags,
      raw: table,
    }
  })

  // ── Clash detection ──────────────────────────────────────────
  detectNameClashes(tables)

  // ── Views ──────────────────────────────────────────────────────
  const rawViews = getViewsFromRealm(ctx.realm)
  const viewSchemas = new Set(rawViews.map((v) => v._schema))
  const isMultiSchemaViews = viewSchemas.size > 1 || isMultiSchema

  const views: EnrichedView[] = rawViews.map((view) => {
    const schema = view._schema
    const viewTags = findTagsForObject(ctx.allFileTags, view.name)
    const skipped = isSkipped(viewTags, ctx.templateName)

    const rename = findRename(viewTags, ctx.templateName)
    let pascalName: string
    if (rename) {
      pascalName = rename
    } else {
      const baseName = toPascalCase(singularizeLast(view.name))
      if (isMultiSchemaViews && !stripSchema && schema !== defaultSchema) {
        pascalName = toPascalCase(schema) + baseName
      } else {
        pascalName = baseName
      }
    }

    const sqlName = isMultiSchemaViews && schema !== defaultSchema ? `${schema}.${view.name}` : view.name

    const columns: EnrichedColumn[] = (view.columns ?? []).map((col) =>
      enrichColumn(col, view.name, ctx.templateName, ctx.allFileTags),
    )

    return { name: view.name, pascalName, schema, sqlName, skipped, columns, tags: viewTags }
  })

  // ── Enums ─────────────────────────────────────────────────────
  const enums: EnrichedEnum[] = extractEnums(tables, views)

  // ── Functions ─────────────────────────────────────────────────
  const rawFuncsWithSchema = ctx.realm.schemas.flatMap((s) => (s.funcs ?? []).map((f) => ({ ...f, _schema: s.name })))
  const funcSchemas = new Set(rawFuncsWithSchema.map((f) => f._schema))
  const isMultiSchemaFuncs = funcSchemas.size > 1 || isMultiSchema

  const functions: EnrichedFunction[] = rawFuncsWithSchema.map((fn) => {
    const baseName = toPascalCase(fn.name)
    const pascalName =
      isMultiSchemaFuncs && !stripSchema && fn._schema !== defaultSchema
        ? toPascalCase(fn._schema) + baseName
        : baseName
    return {
      name: fn.name,
      pascalName,
      schema: fn._schema,
      args: (fn.args ?? []).map((a) => ({
        name: a.name ?? '',
        type: a.type.type.T ?? a.type.raw ?? 'unknown',
        category: typeCategory(a.type.type),
      })),
      returnType: fn.ret
        ? {
            type: fn.ret.type.T ?? fn.ret.raw ?? 'unknown',
            category: typeCategory(fn.ret.type),
            compositeFields:
              fn.ret.type.kind === 'composite' && 'fields' in fn.ret.type
                ? fn.ret.type.fields.map((f) => ({ name: f.name, type: f.type.T }))
                : undefined,
          }
        : undefined,
      language: fn.lang,
    }
  })

  return { tables, views, enums, functions }
}

/**
 * Get only non-skipped tables from an enriched schema.
 */
export function activeTables(schema: EnrichedSchema): EnrichedTable[] {
  return schema.tables.filter((t) => !t.skipped)
}

/**
 * Find tags with a specific namespace on a table or column.
 */
export function findTagsByNamespace(tags: TagEntry[], namespace: string): TagEntry[] {
  return tags.filter((t) => t.namespace === namespace)
}

/**
 * Get the first arg value from a tag (for positional args).
 */
export function getTagArg(tag: TagEntry, index: number = 0): unknown {
  if (Array.isArray(tag.args)) return tag.args[index]
  return undefined
}

/**
 * Get a named arg value from a tag.
 */
export function getNamedArg(tag: TagEntry, key: string): unknown {
  if (!Array.isArray(tag.args)) return (tag.args as Record<string, unknown>)[key]
  return undefined
}

// ── Internals ────────────────────────────────────────────────────

/**
 * Detect duplicate pascalNames among non-skipped tables and throw a descriptive error.
 */
function detectNameClashes(tables: EnrichedTable[]): void {
  const nameMap = new Map<string, string[]>()
  for (const t of tables) {
    if (t.skipped) continue
    const existing = nameMap.get(t.pascalName) ?? []
    existing.push(`${t.schema}.${t.name}`)
    nameMap.set(t.pascalName, existing)
  }
  for (const [name, sources] of nameMap) {
    if (sources.length > 1) {
      throw new Error(
        `Codegen name clash: "${name}" maps to multiple tables: ${sources.join(', ')}. Use @codegen.rename to disambiguate or set stripSchemaFromName: false.`,
      )
    }
  }
}

/** Enrich a single column using inspector type metadata */
function enrichColumn(
  col: Column,
  parentName: string,
  templateName: string,
  allFileTags: TemplateContext<any>['allFileTags'],
  pkColumns?: Set<string>,
  fkMap?: Map<string, { table: string; column: string; schema: string }>,
): EnrichedColumn {
  const colName = col.name
  const colTags = colName ? findTagsForObject(allFileTags, `${parentName}.${colName}`) : []
  const pgType = getColumnType(col)
  const nullable = isNullable(col)
  const typeOverride = colName ? findTypeOverride(colTags, templateName) : undefined
  const defaultValue = extractDefault(col.default)
  const category = typeCategory(col.type.type)
  const isSerial = category === 'integer' && pgType.toLowerCase().includes('serial')

  // Extract enum values from SchemaType
  let enumValues: string[] | undefined
  if (col.type.type.kind === 'enum') {
    enumValues = col.type.type.values
  }

  // Extract composite fields from SchemaType
  let compositeFields: Array<{ name: string; type: string }> | undefined
  if (col.type.type.kind === 'composite' && 'fields' in col.type.type) {
    compositeFields = col.type.type.fields.map((f) => ({ name: f.name, type: f.type.T }))
  }

  return {
    name: colName,
    pascalName: colName ? toPascalCase(colName) : '',
    camelName: colName ? toCamelCase(colName) : '',
    pgType,
    category,
    isCustomType: isCustomType(col.type.type),
    enumValues,
    compositeFields,
    nullable,
    isPrimaryKey: pkColumns?.has(colName) ?? false,
    isSerial,
    defaultValue,
    foreignKey: fkMap?.get(colName),
    typeOverride,
    tags: colTags,
    raw: col,
  }
}

/** Extract enums from all columns (tables + views) with category 'enum' and enum_values */
function extractEnums(tables: EnrichedTable[], views: EnrichedView[]): EnrichedEnum[] {
  const found = new Map<string, { values: string[]; schema: string }>()

  const allSources = [
    ...tables.map((t) => ({ schema: t.schema, columns: t.columns })),
    ...views.map((v) => ({ schema: v.schema, columns: v.columns })),
  ]

  for (const source of allSources) {
    for (const col of source.columns) {
      if (col.category === 'enum' && col.enumValues?.length && !found.has(col.pgType)) {
        found.set(col.pgType, { values: col.enumValues, schema: source.schema })
      }
    }
  }

  return [...found.entries()].map(([name, { values, schema }]) => ({
    name,
    pascalName: toPascalCase(name),
    schema,
    values,
  }))
}

function extractDefault(def: unknown): string | undefined {
  if (!def || typeof def !== 'object') return undefined
  const d = def as Record<string, unknown>
  let val: string | undefined
  if ('X' in d) val = String(d.X)
  else if ('V' in d) val = String(d.V)
  if (!val) return undefined

  // Strip SQL type casts: 'available'::character varying -> 'available'
  const castIdx = val.indexOf('::')
  if (castIdx !== -1) val = val.slice(0, castIdx)

  // Strip SQL string quotes: 'available' -> available
  if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1)

  return val
}

function toCamelCase(name: string): string {
  const pascal = toPascalCase(name)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}
