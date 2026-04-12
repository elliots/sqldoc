import type { DiffDriver } from '../internal/sqlx.ts'
import { attrsEqual, exprEqual } from '../internal/sqlx.ts'
import type { DiffOptions } from '../schema/inspect.ts'
import type { Change } from '../schema/migrate.ts'
import { ChangeKind } from '../schema/migrate.ts'
import type { Attr, Column, Index, Realm, Schema, Table, View } from '../schema/schema.ts'
import { normalizeDefault, typesEquivalent } from './convert.ts'

// -- Helper: find attribute by kind --

function findAttr<T>(attrs: Attr[] | undefined, kind: string): T | undefined {
  if (!attrs) return undefined
  return attrs.find((a) => 'kind' in a && (a as any).kind === kind) as T | undefined
}

function hasAttr(attrs: Attr[] | undefined, kind: string): boolean {
  return findAttr(attrs, kind) !== undefined
}

// -- Generated Index Name Patterns --

/**
 * MSSQL auto-generates constraint/index names with these patterns:
 * - PK__tablename__hexsuffix (primary key)
 * - UQ__tablename__hexsuffix (unique constraint)
 * - DF__tablename__colname__hexsuffix (default constraint)
 * - CK__tablename__hexsuffix (check constraint)
 * - IX_tablename_col (index naming convention, not always auto-generated)
 * - FK__tablename__hexsuffix (foreign key)
 */
const generatedNamePatterns = [
  /^PK__[A-Za-z0-9_]+__[0-9A-Fa-f]+$/,
  /^UQ__[A-Za-z0-9_]+__[0-9A-Fa-f]+$/,
  /^DF__[A-Za-z0-9_]+__[0-9A-Fa-f]+$/,
  /^CK__[A-Za-z0-9_]+__[0-9A-Fa-f]+$/,
  /^FK__[A-Za-z0-9_]+__[0-9A-Fa-f]+$/,
]

// -- MssqlDiff --

/**
 * MssqlDiff provides MSSQL-specific schema diffing.
 * Implements DiffDriver for use with the generic diff engine.
 */
export class MssqlDiff implements DiffDriver {
  /** Returns a changeset for migrating schema attributes from one state to the other. */
  schemaAttrDiff(from: Schema, to: Schema): Change[] {
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

  /** Returns a changeset for migrating schema objects from one state to the other. */
  schemaObjectDiff(_from: Schema, _to: Schema, _opts?: DiffOptions): Change[] {
    // MSSQL does not have enums, domains, composites, or extensions as schema-level objects.
    // Sequences are handled as top-level schema changes, not schema objects.
    return []
  }

  /** Returns a changeset for migrating realm objects from one state to the other. */
  realmObjectDiff(_from: Realm, _to: Realm): Change[] {
    // MSSQL does not have realm-level objects like PostgreSQL extensions.
    return []
  }

  /** Returns a changeset for migrating table attributes from one state to the other. */
  tableAttrDiff(from: Table, to: Table, _opts?: DiffOptions): Change[] {
    const changes: Change[] = []

    // Comment change (via MS_Description extended property)
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

    // Type change (accounting for MSSQL aliases)
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

    // Generated/computed column change
    if (this.generatedChanged(from, to)) {
      change |= ChangeKind.ChangeGenerated
    }

    // Comment change (via MS_Description extended property)
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

  /** Reports if the index attributes were changed. */
  indexAttrChanged(from: Attr[], to: Attr[]): boolean {
    // Compare index type (CLUSTERED vs NONCLUSTERED)
    const fromType = this.getIndexType(from)
    const toType = this.getIndexType(to)
    if (fromType !== toType) return true

    // Compare filter (WHERE clause for filtered indexes)
    const fromFilter = findAttr<{ kind: 'predicate'; P: string }>(from, 'predicate')
    const toFilter = findAttr<{ kind: 'predicate'; P: string }>(to, 'predicate')
    if ((fromFilter?.P ?? '') !== (toFilter?.P ?? '')) return true

    // Compare INCLUDE columns
    const fromInclude = findAttr<{ kind: 'include'; columns: string[] }>(from, 'include')
    const toInclude = findAttr<{ kind: 'include'; columns: string[] }>(to, 'include')
    const fromCols = fromInclude?.columns ?? []
    const toCols = toInclude?.columns ?? []
    if (fromCols.length !== toCols.length) return true
    for (let i = 0; i < fromCols.length; i++) {
      if (fromCols[i] !== toCols[i]) return true
    }

    return false
  }

  /** Reports if the index-part attributes at position i were changed. */
  indexPartAttrChanged(from: Index, to: Index, i: number): boolean {
    const fromPart = from.parts[i]
    const toPart = to.parts[i]
    if (!fromPart || !toPart) return false

    // Compare part-level attributes (MSSQL indexes have minimal part attrs)
    return !attrsEqual(fromPart.attrs, toPart.attrs)
  }

  /**
   * Reports if the index name was generated by the database for unnamed constraints.
   * Uses the `system_named` attribute set by the inspector from sys.key_constraints.is_system_named,
   * with regex fallback for patterns like PK__table__hex, UQ__table__hex.
   */
  isGeneratedIndexName(_table: Table, index: Index): boolean {
    if (!index.name) return false

    // Authoritative: inspector sets system_named attr from sys.key_constraints
    const sysNamed = index.attrs?.find((a: any) => a.kind === 'system_named')
    if (sysNamed) return true

    // Regex fallback for patterns like PK__table__hex
    for (const pattern of generatedNamePatterns) {
      if (pattern.test(index.name)) return true
    }

    return false
  }

  /**
   * Reports if the foreign key referential action was changed.
   * In MSSQL, the default action is NO_ACTION (equivalent to NO ACTION).
   */
  referenceChanged(from: string | undefined, to: string | undefined): boolean {
    const normalize = (v: string | undefined): string => {
      if (!v || v === '') return 'NO ACTION'
      // MSSQL may use NO_ACTION with underscores
      return v.replace(/_/g, ' ')
    }
    return normalize(from) !== normalize(to)
  }

  /** Reports if any of the foreign-key attributes were changed. */
  foreignKeyAttrChanged(_from: Attr[], _to: Attr[]): boolean {
    return false
  }

  /** Reports if the column is a generated/computed column. */
  isGeneratedColumn(col: Column): boolean {
    return hasAttr(col.attrs, 'generated')
  }

  /**
   * Normalize a table before diffing.
   * Resolves MSSQL-specific type quirks: sysname -> nvarchar(128),
   * timestamp -> rowversion, and strips bracket-quoted identifiers.
   */
  normalize(table: Table): void {
    for (const col of table.columns) {
      const t = col.type.type
      if (!t) continue

      // Normalize sysname to nvarchar(128)
      if (t.T.toLowerCase() === 'sysname') {
        t.T = 'nvarchar'
        ;(t as any).kind = 'string'
        ;(t as any).size = 128
      }

      // Normalize timestamp to rowversion
      if (t.T.toLowerCase() === 'timestamp') {
        t.T = 'rowversion'
        ;(t as any).kind = 'binary'
      }

      // Normalize float(53) to float (53 is the default precision)
      if (t.T.toLowerCase() === 'float' && (t as any).precision === 53) {
        delete (t as any).precision
      }

      // Normalize real to float with precision=24 implicit
      // (no change needed — real is its own canonical name)

      // Normalize default expressions by stripping outer parentheses
      if (col.default) {
        if ('X' in col.default) {
          const normalized = normalizeDefault(col.default.X)
          if (normalized !== undefined) col.default = { X: normalized }
        } else if ('V' in col.default) {
          const normalized = normalizeDefault(col.default.V)
          if (normalized !== undefined) col.default = { V: normalized }
        }
      }
    }
  }

  // -- Internal helpers --

  /** Reports if the column type was changed, accounting for MSSQL aliases. */
  private typeChanged(from: Column, to: Column): boolean {
    const fromT = from.type.type
    const toT = to.type.type
    if (!fromT || !toT) return false

    // Different kinds always means changed
    if (fromT.kind !== toT.kind) {
      // Check for aliases that cross kind boundaries (e.g., sysname string vs nvarchar string)
      return !typesEquivalent(fromT, toT)
    }

    // Use the alias-aware equivalence check
    return !typesEquivalent(fromT, toT)
  }

  /** Reports if the default value of a column was changed. */
  private defaultChanged(from: Column, to: Column): boolean {
    const hasFrom = from.default !== undefined
    const hasTo = to.default !== undefined
    if (hasFrom !== hasTo) return true
    if (!hasFrom && !hasTo) return false

    // Direct expression comparison
    if (exprEqual(from.default, to.default)) return false

    // Try normalized comparison (strip outer parens, compare content)
    const d1 = from.default ? ('X' in from.default ? from.default.X : 'V' in from.default ? from.default.V : '') : ''
    const d2 = to.default ? ('X' in to.default ? to.default.X : 'V' in to.default ? to.default.V : '') : ''
    const n1 = normalizeDefault(d1)
    const n2 = normalizeDefault(d2)
    if (n1 === n2) return false

    return true
  }

  /**
   * Reports if identity attributes changed.
   * MSSQL identity is specified as IDENTITY(seed, increment).
   */
  private identityChanged(from: Attr[] | undefined, to: Attr[] | undefined): boolean {
    const fromId = findAttr<{ kind: 'identity'; seed: number; increment: number }>(from, 'identity')
    const toId = findAttr<{ kind: 'identity'; seed: number; increment: number }>(to, 'identity')

    const hasFrom = fromId !== undefined
    const hasTo = toId !== undefined
    if (!hasFrom && !hasTo) return false
    if (hasFrom !== hasTo) return true

    // Compare identity properties
    const fromSeed = fromId!.seed ?? 1
    const toSeed = toId!.seed ?? 1
    if (fromSeed !== toSeed) return true

    const fromInc = fromId!.increment ?? 1
    const toInc = toId!.increment ?? 1
    return fromInc !== toInc
  }

  /** Reports if the generated/computed expression of a column was changed. */
  private generatedChanged(from: Column, to: Column): boolean {
    const fromGen = findAttr<{ kind: 'generated'; expr: string; type?: string }>(from.attrs, 'generated')
    const toGen = findAttr<{ kind: 'generated'; expr: string; type?: string }>(to.attrs, 'generated')

    const hasFrom = fromGen !== undefined
    const hasTo = toGen !== undefined

    if (!hasFrom && !hasTo) return false
    if (hasFrom !== hasTo) return true

    // Compare computed expressions
    if (fromGen!.expr !== toGen!.expr) return true

    // Compare persisted vs non-persisted
    const fromType = fromGen!.type ?? 'VIRTUAL'
    const toType = toGen!.type ?? 'VIRTUAL'
    return fromType !== toType
  }

  /** Get the index type from attributes, defaulting to NONCLUSTERED. */
  private getIndexType(attrs: Attr[]): string {
    const it = findAttr<{ kind: 'index_type'; T: string }>(attrs, 'index_type')
    return (it?.T ?? 'NONCLUSTERED').toUpperCase()
  }
}
