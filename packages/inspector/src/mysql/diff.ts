// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/mysql/diff_oss.go

import type { DiffDriver } from '../internal/sqlx.ts'
import { exprEqual, mayWrap, typesEqual } from '../internal/sqlx.ts'
import type { DiffOptions } from '../schema/inspect.ts'
import type { Change } from '../schema/migrate.ts'
import { ChangeKind } from '../schema/migrate.ts'
import type { Attr, Column, Index, Schema, Table, View } from '../schema/schema.ts'
import { typeDDL } from './convert.ts'
import { EngineInnoDB, IndexTypeBTree, storedOrVirtual } from './driver.ts'
import type { AutoIncrementAttr, EngineAttr, IndexTypeAttr, SubPartAttr } from './inspect.ts'

// -- Helper: find attribute by kind --

function findAttr<T>(attrs: Attr[] | undefined, kind: string): T | undefined {
  if (!attrs) return undefined
  return attrs.find((a) => 'kind' in a && (a as any).kind === kind) as T | undefined
}

function hasAttr(attrs: Attr[] | undefined, kind: string): boolean {
  return findAttr(attrs, kind) !== undefined
}

// -- MysqlDiff --

/**
 * MysqlDiff provides MySQL-specific schema diffing.
 * Implements DiffDriver for use with the generic diff engine.
 */
export class MysqlDiff implements DiffDriver {
  /** Returns a changeset for migrating schema attributes from one state to the other. */
  schemaAttrDiff(from: Schema, to: Schema): Change[] {
    const changes: Change[] = []
    // Charset change
    const charsetChange = this.attrValueChange(from.attrs, to.attrs, 'charset')
    if (charsetChange) changes.push(charsetChange)
    // Collation change
    const collationChange = this.attrValueChange(from.attrs, to.attrs, 'collation')
    if (collationChange) changes.push(collationChange)
    return changes
  }

  /** Returns a changeset for migrating schema objects from one state to the other. */
  schemaObjectDiff(_from: Schema, _to: Schema, _opts?: DiffOptions): Change[] {
    return []
  }

  /** Returns a changeset for migrating realm objects from one state to the other. */
  realmObjectDiff(_from: import('../schema/schema.ts').Realm, _to: import('../schema/schema.ts').Realm): Change[] {
    return []
  }

  /** Returns a changeset for migrating table attributes from one state to the other. */
  tableAttrDiff(from: Table, to: Table, _opts?: DiffOptions): Change[] {
    const changes: Change[] = []

    // AUTO_INCREMENT change
    const fromAI = findAttr<AutoIncrementAttr>(from.attrs, 'auto_increment')
    const toAI = findAttr<AutoIncrementAttr>(to.attrs, 'auto_increment')
    if (toAI && toAI.V > 1 && (!fromAI || toAI.V > fromAI.V)) {
      changes.push({
        type: 'modify_attr',
        from: (fromAI ?? { kind: 'auto_increment', V: 0 }) as unknown as Attr,
        to: toAI as unknown as Attr,
      })
    }

    // Comment change
    const fromComment = findAttr<{ kind: 'comment'; text: string }>(from.attrs, 'comment')
    const toComment = findAttr<{ kind: 'comment'; text: string }>(to.attrs, 'comment')
    if (fromComment?.text !== toComment?.text) {
      if (toComment) {
        changes.push({
          type: fromComment ? 'modify_attr' : 'add_attr',
          ...(fromComment ? { from: fromComment as Attr, to: toComment as Attr } : { A: toComment as Attr }),
        } as Change)
      } else if (fromComment) {
        changes.push({ type: 'drop_attr', A: fromComment as Attr })
      }
    }

    // Charset change
    const charsetChange = this.attrValueChange(from.attrs, to.attrs, 'charset')
    if (charsetChange) changes.push(charsetChange)

    // Collation change
    const collationChange = this.attrValueChange(from.attrs, to.attrs, 'collation')
    if (collationChange) changes.push(collationChange)

    // Engine change
    const fromEngine = findAttr<EngineAttr>(from.attrs, 'engine')
    const toEngine = findAttr<EngineAttr>(to.attrs, 'engine')
    if (fromEngine && toEngine && fromEngine.V.toLowerCase() !== toEngine.V.toLowerCase()) {
      changes.push({ type: 'modify_attr', from: fromEngine as unknown as Attr, to: toEngine as unknown as Attr })
    } else if (
      fromEngine &&
      !toEngine &&
      !fromEngine.default &&
      fromEngine.V.toLowerCase() !== EngineInnoDB.toLowerCase()
    ) {
      changes.push({
        type: 'modify_attr',
        from: fromEngine as unknown as Attr,
        to: { kind: 'engine', V: EngineInnoDB, default: true } as unknown as Attr,
      })
    }

    // SystemVersioned change (MariaDB)
    const fromSV = hasAttr(from.attrs, 'system_versioned')
    const toSV = hasAttr(to.attrs, 'system_versioned')
    if (fromSV && !toSV) {
      changes.push({ type: 'drop_attr', A: { kind: 'system_versioned' } as unknown as Attr })
    } else if (!fromSV && toSV) {
      changes.push({ type: 'add_attr', A: { kind: 'system_versioned' } as unknown as Attr })
    }

    return changes
  }

  /** Returns the schema change (if any) for migrating one column to the other. */
  columnChange(_fromTable: Table, from: Column, to: Column, _opts?: DiffOptions): Change | undefined {
    let change = ChangeKind.NoChange

    // Comment change
    const fromComment = findAttr<{ kind: 'comment'; text: string }>(from.attrs, 'comment')
    const toComment = findAttr<{ kind: 'comment'; text: string }>(to.attrs, 'comment')
    if (fromComment?.text !== toComment?.text) {
      change |= ChangeKind.ChangeComment
    }

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

    // Generated column change
    if (this.generatedChanged(from, to)) {
      change |= ChangeKind.ChangeGenerated
    }

    // Charset change
    const fromCharset = findAttr<{ kind: 'charset'; V: string }>(from.attrs, 'charset')
    const toCharset = findAttr<{ kind: 'charset'; V: string }>(to.attrs, 'charset')
    if (fromCharset?.V !== toCharset?.V) {
      change |= ChangeKind.ChangeCharset
    }

    // Collation change
    const fromCollation = findAttr<{ kind: 'collation'; V: string }>(from.attrs, 'collation')
    const toCollation = findAttr<{ kind: 'collation'; V: string }>(to.attrs, 'collation')
    if (fromCollation?.V !== toCollation?.V) {
      change |= ChangeKind.ChangeCollate
    }

    if (change === ChangeKind.NoChange) return undefined
    return { type: 'modify_column', from, to, change }
  }

  /** Reports if the index attributes were changed. */
  indexAttrChanged(from: Attr[], to: Attr[]): boolean {
    const fromType = this.getIndexType(from)
    const toType = this.getIndexType(to)
    return fromType !== toType
  }

  /** Reports if the index-part attributes at position i were changed. */
  indexPartAttrChanged(from: Index, to: Index, i: number): boolean {
    const fromSub = findAttr<SubPartAttr>(from.parts[i]?.attrs, 'sub_part')
    const toSub = findAttr<SubPartAttr>(to.parts[i]?.attrs, 'sub_part')
    const fromHas = fromSub !== undefined
    const toHas = toSub !== undefined
    return fromHas !== toHas || (fromHas && toHas && fromSub!.len !== toSub!.len)
  }

  /** Reports if the index name was generated by the database for unnamed constraints. */
  isGeneratedIndexName(_table: Table, idx: Index): boolean {
    if (!idx.name || idx.parts.length === 0 || !idx.parts[0].column) return false
    const colName = idx.parts[0].column
    if (idx.name === colName) return true
    if (idx.name.startsWith(`${colName}_`)) {
      const suffix = idx.name.slice(colName.length + 1)
      const n = parseInt(suffix, 10)
      return !Number.isNaN(n) && n > 1
    }
    return false
  }

  /** Reports if the foreign key referential action was changed. */
  referenceChanged(from: string | undefined, to: string | undefined): boolean {
    // MySQL treats NO ACTION and RESTRICT as the same
    const normalize = (v: string | undefined): string => {
      if (!v || v === '' || v === 'RESTRICT') return 'NO ACTION'
      return v
    }
    return normalize(from) !== normalize(to)
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
    // No normalization needed without a live connection
  }

  /** Returns the view attribute changes. */
  viewAttrChanges(_from: View, _to: View): Change[] {
    return []
  }

  // -- Internal helpers --

  private typeChanged(from: Column, to: Column): boolean {
    const fromT = from.type.type
    const toT = to.type.type
    if (!fromT || !toT) return false
    if (fromT.kind !== toT.kind) return true

    try {
      const ft = typeDDL(fromT)
      const tt = typeDDL(toT)
      return ft !== tt
    } catch {
      // If formatting fails, compare structurally
      return !typesEqual(fromT, toT)
    }
  }

  private defaultChanged(from: Column, to: Column): boolean {
    const d1 = from.default
    const d2 = to.default
    if (!d1 && !d2) return false
    if (!d1 || !d2) return true
    return !exprEqual(d1, d2)
  }

  private generatedChanged(from: Column, to: Column): boolean {
    const fromGen = findAttr<{ kind: 'generated'; expr: string; type?: string }>(from.attrs, 'generated')
    const toGen = findAttr<{ kind: 'generated'; expr: string; type?: string }>(to.attrs, 'generated')
    if (!fromGen && !toGen) return false
    if (!fromGen || !toGen) return true
    return (
      mayWrap(fromGen.expr) !== mayWrap(toGen.expr) || storedOrVirtual(fromGen.type) !== storedOrVirtual(toGen.type)
    )
  }

  private getIndexType(attrs: Attr[]): string {
    const it = findAttr<IndexTypeAttr>(attrs, 'index_type')
    return (it?.T ?? IndexTypeBTree).toUpperCase()
  }

  /** Returns a Change for a named value attribute (charset or collation). */
  private attrValueChange(
    fromAttrs: Attr[] | undefined,
    toAttrs: Attr[] | undefined,
    kind: string,
  ): Change | undefined {
    const fromVal = findAttr<{ kind: string; V: string }>(fromAttrs, kind)
    const toVal = findAttr<{ kind: string; V: string }>(toAttrs, kind)
    if (!fromVal && !toVal) return undefined
    if (!fromVal && toVal) {
      return { type: 'add_attr', A: toVal as unknown as Attr }
    }
    if (fromVal && !toVal) return undefined // Cannot DROP charset/collation
    if (fromVal!.V !== toVal!.V) {
      return { type: 'modify_attr', from: fromVal as unknown as Attr, to: toVal as unknown as Attr }
    }
    return undefined
  }
}
