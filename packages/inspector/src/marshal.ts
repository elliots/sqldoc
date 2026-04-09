// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: cmd/atlas-wasi/marshal.go

import type {
  Attr,
  Check,
  Column,
  ColumnType,
  CompositeType,
  EnumType,
  Expr,
  ForeignKey,
  Func,
  FuncArg,
  Index,
  IndexPart,
  Proc,
  Realm,
  Schema,
  SchemaType,
  Sequence,
  Table,
  Tag,
  Trigger,
  View,
} from './schema/schema.ts'
import type {
  AtlasAttr,
  AtlasColumn,
  AtlasColumnType,
  AtlasCompositeType,
  AtlasExpr,
  AtlasForeignKey,
  AtlasFunc,
  AtlasFuncArg,
  AtlasIndex,
  AtlasIndexPart,
  AtlasProc,
  AtlasRealm,
  AtlasSchema,
  AtlasTable,
  AtlasTrigger,
  AtlasView,
  TypeCategory,
} from '@sqldoc/db'

// -- Type Category --

/**
 * Determine the TypeCategory for a SchemaType.
 * Maps the `kind` discriminant to the category enum.
 */
export function typeCategory(t: SchemaType): TypeCategory {
  switch (t.kind) {
    case 'string':
      return 'string'
    case 'integer':
      return 'integer'
    case 'float':
      return 'float'
    case 'decimal':
      return 'decimal'
    case 'boolean':
      return 'boolean'
    case 'time':
      return 'time'
    case 'binary':
      return 'binary'
    case 'json':
      return 'json'
    case 'uuid':
      return 'uuid'
    case 'spatial':
      return 'spatial'
    case 'enum':
      return 'enum'
    case 'composite':
      return 'composite'
    case 'array':
      return 'array'
    case 'serial':
      return 'integer' // serial maps to integer category
    case 'network':
      return 'string' // network types map to string category
    case 'currency':
      return 'decimal' // money maps to decimal
    case 'text_search':
      return 'string'
    case 'interval':
      return 'time'
    case 'domain':
      return 'unknown' // domain uses underlying type -- would need recursive resolution
    case 'range':
      return 'unknown'
    case 'unsupported':
      return 'unknown'
    default:
      return 'unknown'
  }
}

/**
 * Check if a type is user-defined (enum, composite, domain).
 */
function isCustomType(t: SchemaType): boolean {
  return t.kind === 'enum' || t.kind === 'composite' || t.kind === 'domain'
}

// -- Expression Serialization --

function marshalExpr(e: Expr | undefined): AtlasExpr | undefined {
  if (!e) return undefined
  if ('X' in e) return { X: e.X }
  if ('V' in e) return { V: e.V }
  return undefined
}

// -- Attribute Serialization --

function marshalAttrs(attrs: Attr[] | undefined): AtlasAttr[] | undefined {
  if (!attrs || attrs.length === 0) return undefined
  const result: AtlasAttr[] = []
  for (const a of attrs) {
    if ('kind' in a) {
      switch ((a as any).kind) {
        case 'tag': {
          const tag = a as Tag
          result.push({ Name: tag.name, Args: tag.args })
          break
        }
        case 'comment': {
          const comment = a as { kind: 'comment'; text: string }
          result.push({ Text: comment.text })
          break
        }
        default:
          // Skip driver-specific attrs that may have cycles
          break
      }
    } else if ('Name' in a && 'Args' in a) {
      // Already in AtlasTag format
      result.push(a as AtlasAttr)
    } else if ('Text' in a) {
      // Already in AtlasComment format
      result.push(a as AtlasAttr)
    } else if ('Expr' in a) {
      // Already in AtlasCheck format
      result.push(a as AtlasAttr)
    }
  }
  return result.length > 0 ? result : undefined
}

// -- Column Type Serialization --

/**
 * Marshal a SchemaType to the output ColumnType format.
 */
export function marshalColumnType(ct: ColumnType): AtlasColumnType {
  const result: AtlasColumnType = {
    null: ct.null || undefined,
    raw: ct.raw,
  }

  if (ct.type) {
    result.T = ct.type.T
    result.category = typeCategory(ct.type)
    result.is_custom = isCustomType(ct.type) || undefined

    // Extract enum values
    if (ct.type.kind === 'enum') {
      result.enum_values = (ct.type as EnumType).values
    }

    // Extract composite fields
    if (ct.type.kind === 'composite') {
      const comp = ct.type as CompositeType
      result.composite_fields = comp.fields.map(f => ({
        name: f.name,
        type: f.type.T,
      }))
    }
  }

  return result
}

// -- Column Serialization --

/**
 * Marshal a rich Column to output format.
 */
export function marshalColumn(col: Column): AtlasColumn {
  const result: AtlasColumn = {
    name: col.name,
    attrs: marshalAttrs(col.attrs),
  }

  if (col.type) {
    result.type = marshalColumnType(col.type)
  }

  if (col.default) {
    result.default = marshalExpr(col.default)
  }

  return result
}

// -- Index Serialization --

function marshalIndexPart(part: IndexPart): AtlasIndexPart {
  return {
    column: part.column,
    desc: part.desc || undefined,
    attrs: marshalAttrs(part.attrs),
  }
}

function marshalIndex(idx: Index): AtlasIndex {
  return {
    name: idx.name,
    unique: idx.unique || undefined,
    parts: idx.parts.map(marshalIndexPart),
    attrs: marshalAttrs(idx.attrs),
  }
}

// -- Foreign Key Serialization --

function marshalForeignKey(fk: ForeignKey): AtlasForeignKey {
  return {
    symbol: fk.symbol,
    columns: fk.columns,
    ref_table: fk.refTable,
    ref_columns: fk.refColumns,
    on_update: fk.onUpdate,
    on_delete: fk.onDelete,
  }
}

// -- Trigger Serialization --

function marshalTrigger(tr: Trigger): AtlasTrigger {
  return {
    name: tr.name,
    attrs: marshalAttrs(tr.attrs),
  }
}

// -- Function Serialization --

function marshalFuncArg(arg: FuncArg): AtlasFuncArg {
  return {
    name: arg.name,
    type: arg.type ? marshalColumnType(arg.type) : undefined,
    mode: arg.mode,
  }
}

function marshalFunc(fn: Func, compositesByName?: Map<string, Array<{ name: string; type: string }>>): AtlasFunc {
  const result: AtlasFunc = {
    name: fn.name,
    lang: fn.lang,
    attrs: marshalAttrs(fn.attrs),
  }

  if (fn.args && fn.args.length > 0) {
    result.args = fn.args.map(marshalFuncArg)
  }

  if (fn.ret) {
    const retType = marshalColumnType(fn.ret)
    // Resolve composite fields for SETOF <composite_type> return types
    if (
      compositesByName &&
      (!retType.composite_fields || retType.composite_fields.length === 0) &&
      retType.T &&
      retType.T.toLowerCase().startsWith('setof ')
    ) {
      const innerType = retType.T.slice(6).toLowerCase()
      const fields = compositesByName.get(innerType)
      if (fields) {
        retType.composite_fields = fields
        retType.category = 'composite'
        retType.is_custom = true
      }
    }
    result.ret = retType
  }

  return result
}

// -- Proc Serialization --

function marshalProc(p: Proc): AtlasProc {
  return {
    name: p.name,
    attrs: marshalAttrs(p.attrs),
  }
}

// -- View Serialization --

function marshalView(v: View): AtlasView {
  const result: AtlasView = {
    name: v.name,
    def: v.def,
    attrs: marshalAttrs(v.attrs),
  }

  if (v.columns && v.columns.length > 0) {
    result.columns = v.columns.map(marshalColumn)
  }

  return result
}

// -- Table Serialization --

function marshalTable(t: Table): AtlasTable {
  const result: AtlasTable = {
    name: t.name,
    attrs: marshalAttrs(t.attrs),
  }

  if (t.columns.length > 0) {
    result.columns = t.columns.map(marshalColumn)
  }

  if (t.indexes && t.indexes.length > 0) {
    result.indexes = t.indexes.map(marshalIndex)
  }

  if (t.primaryKey) {
    result.primary_key = marshalIndex(t.primaryKey)
  }

  if (t.foreignKeys && t.foreignKeys.length > 0) {
    result.foreign_keys = t.foreignKeys.map(marshalForeignKey)
  }

  if (t.triggers && t.triggers.length > 0) {
    result.triggers = t.triggers.map(marshalTrigger)
  }

  return result
}

// -- Schema Serialization --

function marshalSchema(s: Schema): AtlasSchema {
  const result: AtlasSchema = {
    name: s.name,
    attrs: marshalAttrs(s.attrs),
  }

  if (s.tables && s.tables.length > 0) {
    result.tables = s.tables.map(marshalTable)
  }

  if (s.views && s.views.length > 0) {
    result.views = s.views.map(marshalView)
  }

  // Build composite type lookup for resolving function return types
  const compositesByName = new Map<string, Array<{ name: string; type: string }>>()
  if (s.compositeTypes && s.compositeTypes.length > 0) {
    result.composite_types = s.compositeTypes.map(ct => {
      const fields = ct.fields.map(f => ({ name: f.name, type: f.type.T }))
      compositesByName.set(ct.T.toLowerCase(), fields)
      return { name: ct.T, fields }
    })
  }

  if (s.funcs && s.funcs.length > 0) {
    result.funcs = s.funcs.map(f => marshalFunc(f, compositesByName))
  }

  if (s.procs && s.procs.length > 0) {
    result.procs = s.procs.map(marshalProc)
  }

  return result
}

// -- Realm Serialization --

/**
 * Marshal a rich internal Realm to the AtlasRealm output format.
 * Per user decision: output matches rich internal types with cycles filtered.
 * Back-pointers are omitted. Deps/Refs use Object string references.
 */
export function marshalRealm(realm: Realm): AtlasRealm {
  return {
    schemas: realm.schemas.map(marshalSchema),
    attrs: marshalAttrs(realm.attrs),
  }
}
