// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/mysql/tidb.go

import type { Attr, Column, Index, Realm, Schema, Table, View } from '../schema/schema.ts'
import type { Change } from '../schema/migrate.ts'
import type { InspectOptions, InspectRealmOption, ExecQuerier } from '../schema/inspect.ts'
import type { DiffOptions } from '../schema/inspect.ts'
import type { DiffDriver } from '../internal/sqlx.ts'
import type { PlanDriver } from '../internal/plan.ts'
import { MysqlInspector } from './inspect.ts'
import type { AutoIncrementAttr } from './inspect.ts'
import { MysqlDiff } from './diff.ts'
import { MysqlPlan } from './migrate.ts'

// -- Helper: find attribute by kind --

function findAttr<T extends Attr>(attrs: Attr[] | undefined, kind: string): T | undefined {
  if (!attrs) return undefined
  return attrs.find(a => 'kind' in a && (a as any).kind === kind) as T | undefined
}

// -- TiDB Priority Function --

/**
 * Computes the priority of each change for TiDB.
 *
 * TiDB does not support multi-schema ALTERs (multiple changes in a single ALTER statement).
 * This function helps order ALTERs so they work. E.g. priority gives precedence to
 * DropForeignKey over DropColumn, because a column cannot be dropped if its FK was not
 * dropped first.
 */
export function priority(change: Change): number {
  switch (change.type) {
    case 'modify_table':
    case 'modify_schema':
      // Each should have a single change since we apply `flat` before sorting
      return (change as any).changes?.length > 0 ? priority((change as any).changes[0]) : 4
    case 'add_column':
      return 1
    case 'drop_index':
    case 'drop_foreign_key':
    case 'drop_attr':
    case 'drop_check':
      return 2
    case 'modify_index':
    case 'modify_foreign_key':
      return 3
    default:
      return 4
  }
}

/**
 * Flatten changes: break down ModifyTable/ModifySchema with multiple sub-changes
 * into individual atomic changes. TiDB requires one change per ALTER.
 */
export function flat(changes: Change[]): Change[] {
  const result: Change[] = []
  for (const change of changes) {
    if (change.type === 'modify_table' && change.changes.length > 1) {
      for (const sub of change.changes) {
        result.push({ type: 'modify_table', T: change.T, changes: [sub] })
      }
    } else if (change.type === 'modify_schema' && change.changes.length > 1) {
      for (const sub of change.changes) {
        result.push({ type: 'modify_schema', S: change.S, changes: [sub] })
      }
    } else {
      result.push(change)
    }
  }
  return result
}

// -- TiDB Inspector --

/**
 * TidbInspect extends MysqlInspector with TiDB-specific behavior.
 * Patches schema objects after standard MySQL inspection.
 */
export class TidbInspect extends MysqlInspector {
  constructor(db: ExecQuerier, version?: string) {
    super(db, version)
  }

  async inspectSchema(name: string, opts?: InspectOptions): Promise<Schema> {
    const s = await super.inspectSchema(name, opts)
    await this.patchSchema(s)
    return s
  }

  async inspectRealm(opts?: InspectRealmOption): Promise<Realm> {
    const r = await super.inspectRealm(opts)
    for (const s of r.schemas) {
      await this.patchSchema(s)
    }
    return r
  }

  /** Patch TiDB-specific column behaviors. */
  private async patchSchema(s: Schema): Promise<void> {
    for (const t of s.tables ?? []) {
      for (const c of t.columns) {
        this.patchColumn(c)
      }
    }
  }

  /** Fix TiDB bit default value formatting bug. */
  private patchColumn(c: Column): void {
    if (c.type.type.kind !== 'binary' || c.type.type.T !== 'bit') return
    // TiDB has a bug where it does not format bit default value correctly
    if (c.default && 'V' in c.default) {
      const lit = c.default.V
      if (!lit.startsWith("b'")) {
        c.default = { V: bytesToBitLiteral(lit) }
      }
    }
  }
}

/**
 * Convert a string value to MySQL bit literal.
 * TiDB bug workaround: https://github.com/pingcap/tidb/issues/32655
 */
function bytesToBitLiteral(value: string): string {
  // Convert string bytes to a number then to binary representation
  let num = 0n
  for (let i = 0; i < value.length; i++) {
    num = (num << 8n) | BigInt(value.charCodeAt(i))
  }
  return `b'${num.toString(2)}'`
}

// -- TiDB Diff --

/**
 * TidbDiff extends MysqlDiff with TiDB-specific diff behavior.
 */
export class TidbDiff extends MysqlDiff {
  // TiDB uses the same diff logic as MySQL.
  // The main difference is in the plan/apply phase where
  // changes are flattened and sorted by priority.
}

// -- TiDB Plan --

/**
 * TidbPlan extends MysqlPlan with TiDB-specific SQL generation.
 * Main difference: TiDB doesn't support multi-change ALTER TABLE,
 * so each change must be a separate ALTER statement.
 */
export class TidbPlan extends MysqlPlan {
  /** Override modifyTable to produce one ALTER per change. */
  modifyTable(from: Table, to: Table, changes: Change[]): string[] {
    // Flatten and sort by priority
    const flatChanges = flat(
      changes.map(c => ({ type: 'modify_table' as const, T: to, changes: [c] })),
    )
    const sorted = flatChanges.sort((a, b) => priority(a) - priority(b))

    // Generate one ALTER TABLE per atomic change
    const stmts: string[] = []
    for (const change of sorted) {
      if (change.type === 'modify_table') {
        const inner = super.modifyTable(from, to, change.changes)
        stmts.push(...inner)
      }
    }
    return stmts
  }
}
