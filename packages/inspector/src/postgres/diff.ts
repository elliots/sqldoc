// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/postgres/diff_oss.go

import type { DiffDriver } from '../internal/sqlx.ts'
import { exprEqual, mayWrap } from '../internal/sqlx.ts'
import type { DiffOptions } from '../schema/inspect.ts'
import type { Change } from '../schema/migrate.ts'
import { ChangeKind } from '../schema/migrate.ts'
import type { Attr, Column, Index, Realm, Schema, Table, View } from '../schema/schema.ts'
import { normalizeDefault, typeDDL } from './convert.ts'
import { IndexTypeBTree } from './driver.ts'

// -- Helper: find attribute by kind --

function findAttr<T extends Attr>(attrs: Attr[] | undefined, kind: string): T | undefined {
  if (!attrs) return undefined
  return attrs.find((a) => 'kind' in a && (a as any).kind === kind) as T | undefined
}

function hasAttr(attrs: Attr[] | undefined, kind: string): boolean {
  return findAttr(attrs, kind) !== undefined
}

// -- PostgresDiff --

/**
 * PostgresDiff provides PostgreSQL-specific schema diffing.
 * Implements DiffDriver for use with the generic diff engine.
 */
export class PostgresDiff implements DiffDriver {
  private schemaName?: string

  constructor(schemaName?: string) {
    this.schemaName = schemaName
  }

  /** Returns a changeset for migrating schema attributes from one state to the other. */
  schemaAttrDiff(from: Schema, to: Schema): Change[] {
    const changes: Change[] = []

    // Skip the default "standard public schema" comment for public schemas
    const fromAttrs = this.skipDefaultComment(from)
    const toAttrs = this.skipDefaultComment(to)

    const fromComment = findAttr<{ kind: 'comment'; text: string }>(fromAttrs, 'comment')
    const toComment = findAttr<{ kind: 'comment'; text: string }>(toAttrs, 'comment')

    if (fromComment?.text !== toComment?.text) {
      if (toComment && fromComment) {
        changes.push({ type: 'modify_attr', from: fromComment as Attr, to: toComment as Attr })
      } else if (toComment) {
        changes.push({ type: 'add_attr', A: toComment as Attr })
      } else if (fromComment) {
        changes.push({ type: 'drop_attr', A: fromComment as Attr })
      }
    }

    return changes
  }

  private skipDefaultComment(s: Schema): Attr[] | undefined {
    const attrs = s.attrs ?? []
    const publicName = this.schemaName || 'public'
    const comment = findAttr<{ kind: 'comment'; text: string }>(attrs, 'comment')
    if (comment?.text === 'standard public schema' && (!s.name || s.name === publicName)) {
      return attrs.filter((a) => !('kind' in a && (a as any).kind === 'comment'))
    }
    return attrs
  }

  /** Returns a changeset for migrating schema objects (enums, composites, domains, extensions, sequences) from one state to the other. */
  schemaObjectDiff(from: Schema, to: Schema, _opts?: DiffOptions): Change[] {
    const changes: Change[] = []

    // Enum diff
    const fromEnums = from.enums ?? []
    const toEnums = to.enums ?? []
    const toEnumMap = new Map(toEnums.map((e) => [e.T, e]))
    const fromEnumMap = new Map(fromEnums.map((e) => [e.T, e]))

    for (const e1 of fromEnums) {
      const e2 = toEnumMap.get(e1.T)
      if (!e2) {
        changes.push({ type: 'drop_object', O: e1 } as any)
      } else if (JSON.stringify(e1.values) !== JSON.stringify(e2.values)) {
        changes.push({ type: 'modify_object', from: e1, to: e2 } as any)
      }
    }
    for (const e of toEnums) {
      if (!fromEnumMap.has(e.T)) {
        changes.push({ type: 'add_object', O: e } as any)
      }
    }

    // Extensions are compared at realm level (realmObjectDiff), not per-schema

    // Domain diff (stored in attrs)
    const fromDomains = ((from.attrs ?? []) as any[]).filter((a) => a?.kind === 'domain')
    const toDomains = ((to.attrs ?? []) as any[]).filter((a) => a?.kind === 'domain')
    const toDomainMap = new Map(toDomains.map((d) => [d.T, d]))
    const fromDomainMap = new Map(fromDomains.map((d) => [d.T, d]))

    for (const d of fromDomains) {
      const toD = toDomainMap.get(d.T)
      if (!toD) {
        changes.push({ type: 'drop_object', O: d } as any)
      } else if (objectChanged(d, toD)) {
        changes.push({ type: 'modify_object', from: d, to: toD } as any)
      }
    }
    for (const d of toDomains) {
      if (!fromDomainMap.has(d.T)) {
        changes.push({ type: 'add_object', O: d } as any)
      }
    }

    // Composite type diff
    const fromComps = from.compositeTypes ?? []
    const toComps = to.compositeTypes ?? []
    const toCompMap = new Map(toComps.map((c) => [c.T, c]))
    const fromCompMap = new Map(fromComps.map((c) => [c.T, c]))

    for (const c of fromComps) {
      const to = toCompMap.get(c.T)
      if (!to) {
        changes.push({ type: 'drop_object', O: c } as any)
      } else if (objectChanged(c, to)) {
        changes.push({ type: 'modify_object', from: c, to } as any)
      }
    }
    for (const c of toComps) {
      if (!fromCompMap.has(c.T)) {
        changes.push({ type: 'add_object', O: c } as any)
      }
    }

    // Range type diff (stored in attrs)
    const fromRanges = ((from.attrs ?? []) as any[]).filter((a) => a?.kind === 'range_type')
    const toRanges = ((to.attrs ?? []) as any[]).filter((a) => a?.kind === 'range_type')
    const toRangeMap = new Map(toRanges.map((r) => [r.T, r]))
    const fromRangeMap = new Map(fromRanges.map((r) => [r.T, r]))

    for (const r of fromRanges) {
      const toR = toRangeMap.get(r.T)
      if (!toR) {
        changes.push({ type: 'drop_object', O: r } as any)
      } else if (objectChanged(r, toR)) {
        changes.push({ type: 'modify_object', from: r, to: toR } as any)
      }
    }
    for (const r of toRanges) {
      if (!fromRangeMap.has(r.T)) {
        changes.push({ type: 'add_object', O: r } as any)
      }
    }

    // Aggregate diff (stored in attrs)
    const fromAggs = ((from.attrs ?? []) as any[]).filter((a) => a?.kind === 'aggregate')
    const toAggs = ((to.attrs ?? []) as any[]).filter((a) => a?.kind === 'aggregate')
    const aggKey = (a: any): string => `${a.name}(${(a.args ?? []).join(',')})`
    const toAggMap = new Map(toAggs.map((a) => [aggKey(a), a]))
    const fromAggMap = new Map(fromAggs.map((a) => [aggKey(a), a]))

    for (const a of fromAggs) {
      const k = aggKey(a)
      const toA = toAggMap.get(k)
      if (!toA) {
        changes.push({ type: 'drop_object', O: a } as any)
      } else if (objectChanged(a, toA)) {
        changes.push({ type: 'modify_object', from: a, to: toA } as any)
      }
    }
    for (const a of toAggs) {
      if (!fromAggMap.has(aggKey(a))) {
        changes.push({ type: 'add_object', O: a } as any)
      }
    }

    return changes
  }

  /** Returns a changeset for migrating realm objects from one state to the other. */
  realmObjectDiff(from: Realm, to: Realm): Change[] {
    const changes: Change[] = []

    // Extensions are realm-wide — compare across all schemas
    const fromExts = new Map<string, any>()
    const toExts = new Map<string, any>()
    for (const s of from.schemas) {
      for (const e of s.extensions ?? []) fromExts.set(e.name, e)
    }
    for (const s of to.schemas) {
      for (const e of s.extensions ?? []) toExts.set(e.name, e)
    }

    for (const [name, e1] of fromExts) {
      const e2 = toExts.get(name)
      if (!e2) {
        changes.push({ type: 'drop_object', O: e1 } as any)
      }
    }
    for (const [name, e] of toExts) {
      if (!fromExts.has(name)) {
        changes.push({ type: 'add_object', O: e } as any)
      }
    }

    return changes
  }

  /** Returns a changeset for migrating table attributes from one state to the other. */
  tableAttrDiff(from: Table, to: Table, _opts?: DiffOptions): Change[] {
    const changes: Change[] = []

    // Comment change
    const fromComment = findAttr<{ kind: 'comment'; text: string }>(from.attrs, 'comment')
    const toComment = findAttr<{ kind: 'comment'; text: string }>(to.attrs, 'comment')
    if (fromComment?.text !== toComment?.text) {
      if (toComment && fromComment) {
        changes.push({ type: 'modify_attr', from: fromComment as Attr, to: toComment as Attr })
      } else if (toComment) {
        changes.push({ type: 'add_attr', A: toComment as Attr })
      } else if (fromComment) {
        changes.push({ type: 'drop_attr', A: fromComment as Attr })
      }
    }

    return changes
  }

  /** Returns the changes between two view attributes. */
  viewAttrChanges(from: View, to: View): Change[] {
    const changes: Change[] = []
    const fromComment = findAttr<{ kind: 'comment'; text: string }>(from.attrs, 'comment')
    const toComment = findAttr<{ kind: 'comment'; text: string }>(to.attrs, 'comment')
    if (fromComment?.text !== toComment?.text) {
      if (toComment && fromComment) {
        changes.push({ type: 'modify_attr', from: fromComment as Attr, to: toComment as Attr })
      } else if (toComment) {
        changes.push({ type: 'add_attr', A: toComment as Attr })
      } else if (fromComment) {
        changes.push({ type: 'drop_attr', A: fromComment as Attr })
      }
    }
    return changes
  }

  /** Returns the schema change (if any) for migrating one column to the other. */
  columnChange(_fromTable: Table, from: Column, to: Column, _opts?: DiffOptions): Change | undefined {
    let change = ChangeKind.NoChange

    // Nullability change
    if (from.type.null !== to.type.null) {
      change |= ChangeKind.ChangeNull
    }

    // Type change
    if (this.typeChanged(from, to)) {
      change |= ChangeKind.ChangeType
    }

    // Default change
    if (this.defaultChanged(from, to)) {
      change |= ChangeKind.ChangeDefault
    }

    // Identity change
    if (this.identityChanged(from.attrs, to.attrs)) {
      change |= ChangeKind.ChangeAttr
    }

    // Generated column change
    if (this.generatedChanged(from, to)) {
      change |= ChangeKind.ChangeGenerated
    }

    // Comment change
    const fromComment = findAttr<{ kind: 'comment'; text: string }>(from.attrs, 'comment')
    const toComment = findAttr<{ kind: 'comment'; text: string }>(to.attrs, 'comment')
    if (fromComment?.text !== toComment?.text) {
      change |= ChangeKind.ChangeComment
    }

    // Collation change
    const fromCollation = findAttr<{ kind: 'collation'; V: string }>(from.attrs, 'collation')
    const toCollation = findAttr<{ kind: 'collation'; V: string }>(to.attrs, 'collation')
    if (fromCollation?.V !== toCollation?.V) {
      change |= ChangeKind.ChangeCollate
    }

    if (change === ChangeKind.NoChange) {
      return undefined
    }

    return { type: 'modify_column', from, to, change }
  }

  /** Reports if the column type was changed. */
  private typeChanged(from: Column, to: Column): boolean {
    const fromT = from.type.type
    const toT = to.type.type
    if (!fromT || !toT) return false

    // Different kinds always means changed
    if (fromT.kind !== toT.kind) return true

    // For array types, compare the underlying element type
    if (fromT.kind === 'array' && toT.kind === 'array') {
      if (fromT.type && toT.type) {
        try {
          const t1 = typeDDL(fromT.type)
          const t2 = typeDDL(toT.type)
          return t1 !== t2
        } catch {
          return fromT.T !== toT.T
        }
      }
      return false
    }

    // For enum types, compare by name and schema
    if (fromT.kind === 'enum' && toT.kind === 'enum') {
      return fromT.T !== toT.T || (fromT.schema ?? '') !== (toT.schema ?? '')
    }

    // For composite types, compare by name and schema
    if (fromT.kind === 'composite' && toT.kind === 'composite') {
      return fromT.T !== toT.T || (fromT.schema ?? '') !== (toT.schema ?? '')
    }

    // For domain types, compare by name and schema
    if (fromT.kind === 'domain' && toT.kind === 'domain') {
      return fromT.T !== toT.T || (fromT.schema ?? '') !== (toT.schema ?? '')
    }

    // For other types, compare the formatted output
    try {
      const t1 = typeDDL(fromT)
      const t2 = typeDDL(toT)
      return t1 !== t2
    } catch {
      return fromT.T !== toT.T
    }
  }

  /** Reports if the default value of a column was changed. */
  private defaultChanged(from: Column, to: Column): boolean {
    const hasFrom = from.default !== undefined
    const hasTo = to.default !== undefined
    if (hasFrom !== hasTo) return true
    if (!hasFrom && !hasTo) return false

    // Compare the expressions
    if (exprEqual(from.default, to.default)) return false

    // Try with cast trimming
    const d1 = from.default ? ('X' in from.default ? from.default.X : 'V' in from.default ? from.default.V : '') : ''
    const d2 = to.default ? ('X' in to.default ? to.default.X : 'V' in to.default ? to.default.V : '') : ''
    const n1 = normalizeDefault(d1, from.type.type?.T ?? '')
    const n2 = normalizeDefault(d2, to.type.type?.T ?? '')
    if (n1 === n2) return false

    return true
  }

  /** Reports if identity attributes changed. */
  private identityChanged(from: Attr[] | undefined, to: Attr[] | undefined): boolean {
    const fromId = findAttr<{ kind: 'identity'; generation: string; sequence?: { start: number; increment: number } }>(
      from,
      'identity',
    )
    const toId = findAttr<{ kind: 'identity'; generation: string; sequence?: { start: number; increment: number } }>(
      to,
      'identity',
    )

    const hasFrom = fromId !== undefined
    const hasTo = toId !== undefined
    if (!hasFrom && !hasTo) return false
    if (hasFrom !== hasTo) return true

    // Compare identity properties
    const fromGen = fromId!.generation || 'BY DEFAULT'
    const toGen = toId!.generation || 'BY DEFAULT'
    if (fromGen !== toGen) return true

    const fromSeq = fromId!.sequence ?? { start: 1, increment: 1 }
    const toSeq = toId!.sequence ?? { start: 1, increment: 1 }
    return fromSeq.start !== toSeq.start || fromSeq.increment !== toSeq.increment
  }

  /** Reports if the generated expression of a column was changed. */
  private generatedChanged(from: Column, to: Column): boolean {
    const fromGen = findAttr<{ kind: 'generated'; expr: string; type?: string }>(from.attrs, 'generated')
    const toGen = findAttr<{ kind: 'generated'; expr: string; type?: string }>(to.attrs, 'generated')

    const hasFrom = fromGen !== undefined
    const hasTo = toGen !== undefined

    if (hasFrom !== hasTo) return true
    if (!hasFrom) return false
    return fromGen!.expr !== toGen!.expr || fromGen!.type !== toGen!.type
  }

  /** Reports if the index attributes were changed. */
  indexAttrChanged(from: Attr[], to: Attr[]): boolean {
    // Compare index types (default is BTREE)
    const fromType = this.getIndexType(from)
    const toType = this.getIndexType(to)
    if (fromType !== toType) return true

    // Compare index predicates (WHERE clause for partial indexes)
    const fromPred = findAttr<{ kind: 'predicate'; P: string }>(from, 'predicate')
    const toPred = findAttr<{ kind: 'predicate'; P: string }>(to, 'predicate')
    {
      const lhs = fromPred?.P ? mayWrap(fromPred.P) : ''
      const rhs = toPred?.P ? mayWrap(toPred.P) : ''
      if (lhs !== rhs) return true
    }

    // Compare NULLS DISTINCT
    const fromND = findAttr<{ kind: 'nulls_distinct'; V: boolean }>(from, 'nulls_distinct')
    const toND = findAttr<{ kind: 'nulls_distinct'; V: boolean }>(to, 'nulls_distinct')
    const fromNDV = fromND?.V ?? true // Default: nulls are distinct
    const toNDV = toND?.V ?? true
    if (fromNDV !== toNDV) return true

    return false
  }

  private getIndexType(attrs: Attr[]): string {
    const idxType = findAttr<{ kind: 'index_type'; T: string }>(attrs, 'index_type')
    return (idxType?.T ?? IndexTypeBTree).toUpperCase()
  }

  /** Reports if the index-part attributes at position i were changed. */
  indexPartAttrChanged(from: Index, to: Index, i: number): boolean {
    const fromPart = from.parts[i]
    const toPart = to.parts[i]
    if (!fromPart || !toPart) return false

    // Compare NULLS FIRST / NULLS LAST
    const fromNF = findAttr<{ kind: 'nulls_first'; V: boolean }>(fromPart.attrs, 'nulls_first')
    const toNF = findAttr<{ kind: 'nulls_first'; V: boolean }>(toPart.attrs, 'nulls_first')

    // Default nulls ordering depends on DESC
    const fromNullsFirst = fromNF?.V ?? fromPart.desc === true
    const toNullsFirst = toNF?.V ?? toPart.desc === true
    if (fromNullsFirst !== toNullsFirst) return true

    // Compare operator class
    const fromOp = findAttr<{ kind: 'op_class'; name: string }>(fromPart.attrs, 'op_class')
    const toOp = findAttr<{ kind: 'op_class'; name: string }>(toPart.attrs, 'op_class')
    if (fromOp && toOp) {
      return fromOp.name !== toOp.name
    }
    if (fromOp !== toOp) return true

    return false
  }

  /** Reports if the index name was generated by the database for unnamed constraints. */
  isGeneratedIndexName(table: Table, index: Index): boolean {
    if (!index.name) return false
    const partNames = index.parts.map((p) => p.column ?? '').filter(Boolean)

    if (partNames.length === 0) return false

    // Auto-generated index names: <table>_<c1>_<c2>_key
    const expected = `${table.name}_${partNames.join('_')}_key`
    if (index.name === expected) return true

    // PostgreSQL appends a number in case of conflict
    const suffix = index.name.slice(expected.length)
    if (suffix.length > 0) {
      const n = parseInt(suffix, 10)
      return !Number.isNaN(n) && n > 0
    }

    return false
  }

  /** Reports if the foreign key referential action was changed. */
  referenceChanged(from: string | undefined, to: string | undefined): boolean {
    // NO ACTION is the default in PostgreSQL
    const a = from || 'NO ACTION'
    const b = to || 'NO ACTION'
    return a !== b
  }

  /** Reports if any of the foreign-key attributes were changed. */
  foreignKeyAttrChanged(_from: Attr[], _to: Attr[]): boolean {
    return false
  }

  /** Reports if the column is a generated/virtual column. */
  isGeneratedColumn(col: Column): boolean {
    return hasAttr(col.attrs, 'generated')
  }

  /** Normalize a table before diffing. */
  normalize(_table: Table): void {
    // PostgreSQL-specific normalization (minimal for OSS)
  }
}

/** Compare schema objects by their key semantic properties. */
function objectChanged(a: any, b: any): boolean {
  return stableStringify(a) !== stableStringify(b)
}

/** JSON.stringify with sorted keys for stable comparison. */
function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return String(obj)
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}
