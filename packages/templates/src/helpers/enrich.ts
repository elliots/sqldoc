/**
 * Enrichment layer — preprocesses Atlas realm + tags into a rich,
 * template-friendly structure. Computed once, used by all templates.
 */
import type { AtlasColumn, AtlasTable, TypeCategory } from '@sqldoc/db'
import type { TemplateContext } from '@sqldoc/ns-codegen'
import { findTagsForObject, getColumnType, getTablesFromRealm, getViewsFromRealm, isNullable } from './atlas.ts'
import { toPascalCase } from './naming.ts'
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
  /** PascalCase name (or @codegen.rename override) */
  pascalName: string
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
  /** Raw Atlas table (escape hatch) */
  raw: AtlasTable
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
  /** Dialect-independent type category from Atlas */
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
  foreignKey?: { table: string; column: string }
  /** Type override from @codegen.type tag (if any) */
  typeOverride?: string
  /** All tags on this column */
  tags: TagEntry[]
  /** Raw Atlas column (escape hatch) */
  raw: AtlasColumn
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
  /** Enum variant values */
  values: string[]
}

export interface EnrichedFunction {
  /** Original SQL function name */
  name: string
  /** PascalCase name */
  pascalName: string
  /** Function arguments */
  args: Array<{ name: string; type: string; category: string }>
  /** Return type */
  returnType?: { type: string; category: string }
  /** Language (sql, plpgsql, etc.) */
  language?: string
}

// ── Enrichment ───────────────────────────────────────────────────

/**
 * Enrich the raw Atlas realm into a template-friendly structure.
 * Computes relationships, PK/FK lookups, tag indexing, naming, etc.
 */
export function enrichRealm(ctx: TemplateContext<any>): EnrichedSchema {
  const rawTables = getTablesFromRealm(ctx.realm)

  // Build reverse FK index: targetTable → relations pointing at it
  const reverseIndex = new Map<string, Relation[]>()
  for (const table of rawTables) {
    for (const fk of table.foreign_keys ?? []) {
      if (!fk.ref_table || !fk.columns?.length) continue
      for (let i = 0; i < fk.columns.length; i++) {
        const rel: Relation = {
          constraintName: fk.symbol ?? '',
          column: fk.ref_columns?.[i] ?? 'id',
          foreignTable: table.name,
          foreignColumn: fk.columns[i],
        }
        const existing = reverseIndex.get(fk.ref_table) ?? []
        existing.push(rel)
        reverseIndex.set(fk.ref_table, existing)
      }
    }
  }

  const tables: EnrichedTable[] = rawTables.map((table) => {
    const tableTags = findTagsForObject(ctx.allFileTags, table.name)
    const skipped = isSkipped(tableTags, ctx.templateName)
    const pascalName = findRename(tableTags, ctx.templateName) ?? toPascalCase(table.name)
    const pkColumns = new Set(
      (table.primary_key?.parts ?? []).map((p) => p.column).filter((c): c is string => c != null),
    )

    // Build FK map for this table
    const fkMap = new Map<string, { table: string; column: string }>()
    const belongsTo: Relation[] = []
    for (const fk of table.foreign_keys ?? []) {
      if (!fk.columns?.length || !fk.ref_table) continue
      for (let i = 0; i < fk.columns.length; i++) {
        const ref = { table: fk.ref_table, column: fk.ref_columns?.[i] ?? 'id' }
        fkMap.set(fk.columns[i], ref)
        belongsTo.push({
          constraintName: fk.symbol ?? '',
          column: fk.columns[i],
          foreignTable: fk.ref_table,
          foreignColumn: ref.column,
        })
      }
    }

    const hasMany = reverseIndex.get(table.name) ?? []

    const columns: EnrichedColumn[] = (table.columns ?? []).map((col) =>
      enrichColumn(col, table.name, ctx.templateName, ctx.allFileTags, pkColumns, fkMap),
    )

    return {
      name: table.name,
      pascalName,
      skipped,
      columns,
      primaryKey: [...pkColumns],
      belongsTo,
      hasMany,
      tags: tableTags,
      raw: table,
    }
  })

  // ── Views ──────────────────────────────────────────────────────
  const rawViews = getViewsFromRealm(ctx.realm)
  const views: EnrichedView[] = rawViews.map((view) => {
    const viewTags = findTagsForObject(ctx.allFileTags, view.name)
    const skipped = isSkipped(viewTags, ctx.templateName)
    const pascalName = findRename(viewTags, ctx.templateName) ?? toPascalCase(view.name)

    let columns: EnrichedColumn[]
    if (view.columns?.length) {
      // Atlas provided column metadata
      columns = view.columns.map((col) => enrichColumn(col, view.name, ctx.templateName, ctx.allFileTags))
    } else if (view.def) {
      // Atlas didn't provide columns — resolve from the SELECT list + source tables
      columns = resolveViewColumns(view.def, tables, view.name, ctx.templateName, ctx.allFileTags)
    } else {
      columns = []
    }

    return { name: view.name, pascalName, skipped, columns, tags: viewTags }
  })

  // ── Enums ─────────────────────────────────────────────────────
  // Extract from all columns (tables + views) since Atlas surfaces enum info per-column
  const enums: EnrichedEnum[] = extractEnums(tables, views)

  // ── Functions ─────────────────────────────────────────────────
  const rawFuncs = ctx.realm.schemas.flatMap((s) => s.funcs ?? [])
  const functions: EnrichedFunction[] = rawFuncs.map((fn) => ({
    name: fn.name,
    pascalName: toPascalCase(fn.name),
    args: (fn.args ?? []).map((a) => ({
      name: a.name ?? '',
      type: a.type?.T ?? a.type?.raw ?? 'unknown',
      category: a.type?.category ?? 'unknown',
    })),
    returnType: fn.ret
      ? {
          type: fn.ret.T ?? fn.ret.raw ?? 'unknown',
          category: fn.ret.category ?? 'unknown',
        }
      : undefined,
    language: fn.lang,
  }))

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
 * Resolve view columns from its SELECT definition by matching column names
 * to source table columns. Handles "SELECT col1, col2 FROM tablename".
 */
function resolveViewColumns(
  viewDef: string,
  tables: EnrichedTable[],
  _viewName: string,
  _templateName: string,
  _allFileTags: TemplateContext<any>['allFileTags'],
): EnrichedColumn[] {
  // Parse "SELECT col1, col2, ... FROM tablename"
  const selectMatch = viewDef.match(/SELECT\s+([\s\S]+?)\s+FROM\s+(\w+)/i)
  if (!selectMatch) return []

  const colList = selectMatch[1]
  const sourceTableName = selectMatch[2]
  const sourceTable = tables.find((t) => t.name === sourceTableName)
  if (!sourceTable) return []

  // Handle SELECT *
  if (colList.trim() === '*') {
    return sourceTable.columns.map((col) => ({
      ...col,
      isPrimaryKey: false,
      isSerial: false,
      foreignKey: undefined,
    }))
  }

  // Parse column names (strip whitespace, handle aliases)
  const colNames = colList.split(',').map((c) => {
    const trimmed = c.trim()
    // Handle "col AS alias" — use the original column name for lookup
    const asMatch = trimmed.match(/^(\w+)\s+AS\s+/i)
    return asMatch ? asMatch[1] : trimmed
  })

  return colNames
    .map((name) => sourceTable.columns.find((c) => c.name === name))
    .filter((c): c is EnrichedColumn => c != null)
    .map((col) => ({
      ...col,
      // Views are read-only — no PK/FK/serial
      isPrimaryKey: false,
      isSerial: false,
      foreignKey: undefined,
    }))
}

/** Enrich a single column using Atlas type metadata */
function enrichColumn(
  col: AtlasColumn,
  parentName: string,
  templateName: string,
  allFileTags: TemplateContext<any>['allFileTags'],
  pkColumns?: Set<string>,
  fkMap?: Map<string, { table: string; column: string }>,
): EnrichedColumn {
  const colTags = findTagsForObject(allFileTags, `${parentName}.${col.name}`)
  const pgType = getColumnType(col)
  const nullable = isNullable(col)
  const typeOverride = findTypeOverride(colTags, templateName)
  const defaultValue = extractDefault(col.default)
  const category = (col.type?.category ?? 'unknown') as TypeCategory
  const isSerial = category === 'integer' && pgType.toLowerCase().includes('serial')

  return {
    name: col.name,
    pascalName: toPascalCase(col.name),
    camelName: toCamelCase(col.name),
    pgType,
    category,
    isCustomType: col.type?.is_custom ?? false,
    enumValues: col.type?.enum_values,
    compositeFields: col.type?.composite_fields,
    nullable,
    isPrimaryKey: pkColumns?.has(col.name) ?? false,
    isSerial,
    defaultValue,
    foreignKey: fkMap?.get(col.name),
    typeOverride,
    tags: colTags,
    raw: col,
  }
}

/** Extract enums from all columns (tables + views) with category 'enum' and enum_values */
function extractEnums(tables: EnrichedTable[], views: EnrichedView[]): EnrichedEnum[] {
  const found = new Map<string, string[]>()

  const allColumns = [...tables.flatMap((t) => t.columns), ...views.flatMap((v) => v.columns)]

  for (const col of allColumns) {
    if (col.category === 'enum' && col.enumValues?.length && !found.has(col.pgType)) {
      found.set(col.pgType, col.enumValues)
    }
  }

  return [...found.entries()].map(([name, values]) => ({
    name,
    pascalName: toPascalCase(name),
    values,
  }))
}

function extractDefault(def: unknown): string | undefined {
  if (!def || typeof def !== 'object') return undefined
  const d = def as Record<string, unknown>
  if ('X' in d) return String(d.X)
  if ('V' in d) return String(d.V)
  return undefined
}

function toCamelCase(name: string): string {
  const pascal = toPascalCase(name)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}
