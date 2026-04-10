// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/schema/dsl.go

import type {
  Attr,
  Check,
  Column,
  ColumnType,
  Comment,
  EnumType,
  ForeignKey,
  Func,
  FuncArg,
  Index,
  IndexPart,
  Proc,
  Schema,
  SchemaType,
  Sequence,
  Table,
  Trigger,
  View,
} from './schema.ts'

// -- Factory Functions --

/** Creates a new Table with defaults. */
export function newTable(name: string): Table {
  return { name, columns: [] }
}

/** Creates a new Column with defaults. */
export function newColumn(name: string): Column {
  return { name, type: { type: { kind: 'unsupported', T: '' } } }
}

/** Creates a new typed Column. */
export function newTypedColumn(name: string, type: ColumnType): Column {
  return { name, type }
}

/** Creates a new Index. */
export function newIndex(name: string): Index {
  return { name, parts: [] }
}

/** Creates a new unique Index. */
export function newUniqueIndex(name: string): Index {
  return { name, unique: true, parts: [] }
}

/** Creates a new ForeignKey. */
export function newForeignKey(symbol: string): ForeignKey {
  return { symbol, columns: [], refTable: '', refColumns: [] }
}

/** Creates a new Check constraint. */
export function newCheck(name: string, expr: string): Check {
  return { name, expr }
}

/** Creates a new View. */
export function newView(name: string, def?: string): View {
  return { name, def }
}

/** Creates a new materialized View. */
export function newMaterializedView(name: string, def?: string): View {
  return { name, def, materialized: true }
}

/** Creates a new Func. */
export function newFunc(name: string): Func {
  return { name }
}

/** Creates a new Proc. */
export function newProc(name: string): Proc {
  return { name }
}

/** Creates a new Trigger. */
export function newTrigger(name: string): Trigger {
  return { name }
}

/** Creates a new Sequence. */
export function newSequence(name: string): Sequence {
  return { name }
}

/** Creates a new FuncArg. */
export function newFuncArg(name: string, type: ColumnType): FuncArg {
  return { name, type }
}

/** Creates a new IndexPart from a column name. */
export function newColumnPart(column: string): IndexPart {
  return { column }
}

/** Creates a new IndexPart from an expression. */
export function newExprPart(expr: string): IndexPart {
  return { expr }
}

// -- Finder Functions --

/** Finds a table by name in a schema. Returns undefined if not found. */
export function findTable(schema: Schema, name: string): Table | undefined {
  return schema.tables?.find((t) => t.name === name)
}

/** Finds a column by name in a table. Returns undefined if not found. */
export function findColumn(table: Table, name: string): Column | undefined {
  return table.columns.find((c) => c.name === name)
}

/** Finds an index by name in a table. Returns undefined if not found. */
export function findIndex(table: Table, name: string): Index | undefined {
  return table.indexes?.find((i) => i.name === name)
}

/** Finds a foreign key by symbol in a table. Returns undefined if not found. */
export function findForeignKey(table: Table, symbol: string): ForeignKey | undefined {
  return table.foreignKeys?.find((fk) => fk.symbol === symbol)
}

/** Finds a view by name in a schema. Returns undefined if not found. */
export function findView(schema: Schema, name: string): View | undefined {
  return schema.views?.find((v) => v.name === name)
}

/** Finds a function by name in a schema. Returns undefined if not found. */
export function findFunc(schema: Schema, name: string): Func | undefined {
  return schema.funcs?.find((f) => f.name === name)
}

/** Finds a procedure by name in a schema. Returns undefined if not found. */
export function findProc(schema: Schema, name: string): Proc | undefined {
  return schema.procs?.find((p) => p.name === name)
}

/** Finds a sequence by name in a schema. Returns undefined if not found. */
export function findSequence(schema: Schema, name: string): Sequence | undefined {
  return schema.sequences?.find((s) => s.name === name)
}

// -- Attribute Helpers --

/**
 * Finds the first attribute with the given kind.
 * Returns undefined if no matching attribute is found.
 */
export function hasAttr<T extends Attr>(attrs: Attr[] | undefined, kind: string): T | undefined {
  if (!attrs) return undefined
  return attrs.find((a) => 'kind' in a && (a as any).kind === kind) as T | undefined
}

/**
 * Sets or replaces an attribute by kind.
 * If an attribute with the same kind exists, it is replaced; otherwise the new attr is appended.
 */
export function setAttr(attrs: Attr[] | undefined, attr: Attr): Attr[] {
  const result = attrs ? [...attrs] : []
  if ('kind' in attr) {
    const kind = (attr as any).kind
    const idx = result.findIndex((a) => 'kind' in a && (a as any).kind === kind)
    if (idx !== -1) {
      result[idx] = attr
      return result
    }
  }
  result.push(attr)
  return result
}

/** Removes an attribute by kind. */
export function removeAttr(attrs: Attr[] | undefined, kind: string): Attr[] {
  if (!attrs) return []
  return attrs.filter((a) => !('kind' in a) || (a as any).kind !== kind)
}

/** Extracts the comment text from an attribute list. Returns undefined if no comment. */
export function commentFor(attrs?: Attr[]): string | undefined {
  const comment = hasAttr<Comment>(attrs, 'comment')
  return comment?.text
}

/** Extracts enum values from a SchemaType. Returns undefined if not an enum. */
export function enumValues(t: SchemaType): string[] | undefined {
  if (t.kind === 'enum') {
    return (t as EnumType).values
  }
  return undefined
}
