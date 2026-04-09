// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/internal/sqlx/plan.go

import type {
  Func,
  Sequence,
  Table,
  Trigger,
  View,
} from '../schema/schema.ts'
import type { Change, Plan } from '../schema/migrate.ts'

// -- PlanDriver Interface --

/**
 * PlanDriver wraps all required methods for generating SQL from changes.
 * Each dialect (postgres, mysql, sqlite) implements this interface.
 */
export interface PlanDriver {
  /** Generate SQL for adding a table. */
  addTable(table: Table): string[]
  /** Generate SQL for dropping a table. */
  dropTable(table: Table): string[]
  /** Generate SQL for modifying a table (column/index/FK changes). */
  modifyTable(from: Table, to: Table, changes: Change[]): string[]
  /** Generate SQL for adding a view. */
  addView?(view: View): string[]
  /** Generate SQL for dropping a view. */
  dropView?(view: View): string[]
  /** Generate SQL for modifying a view. */
  modifyView?(from: View, to: View): string[]
  /** Generate SQL for adding a function. */
  addFunc?(func: Func): string[]
  /** Generate SQL for dropping a function. */
  dropFunc?(func: Func): string[]
  /** Generate SQL for adding a trigger. */
  addTrigger?(trigger: Trigger): string[]
  /** Generate SQL for dropping a trigger. */
  dropTrigger?(trigger: Trigger): string[]
  /** Generate SQL for adding a sequence. */
  addSequence?(seq: Sequence): string[]
  /** Generate SQL for dropping a sequence. */
  dropSequence?(seq: Sequence): string[]
  /** Generate SQL for modifying a sequence. */
  modifySequence?(from: Sequence, to: Sequence): string[]
}

/** Options for the plan engine. */
export interface PlanOptions {
  /** Whether to wrap operations in a transaction. */
  transactional?: boolean
}

// -- Plan Engine --

/**
 * Convert a list of Changes into executable SQL Plans.
 * Uses a PlanDriver for dialect-specific SQL generation.
 */
export function planChanges(
  driver: PlanDriver,
  changes: Change[],
  opts?: PlanOptions,
): Plan[] {
  const stmts: Change[] = []

  for (const change of changes) {
    const sql = changeToSQL(driver, change)
    if (sql.length > 0) {
      stmts.push(change)
    }
  }

  // Group all changes into a single plan
  const plan: Plan = {
    changes,
    transactional: opts?.transactional,
  }

  return [plan]
}

/**
 * Generate SQL statements for a single change.
 * Returns an array of SQL strings.
 */
export function changeToSQL(driver: PlanDriver, change: Change): string[] {
  switch (change.type) {
    case 'add_table':
      return driver.addTable(change.T)

    case 'drop_table':
      return driver.dropTable(change.T)

    case 'modify_table':
      return driver.modifyTable(change.T, change.T, change.changes)

    case 'add_view':
      return driver.addView?.(change.V) ?? []

    case 'drop_view':
      return driver.dropView?.(change.V) ?? []

    case 'modify_view':
      return driver.modifyView?.(change.from, change.to) ?? []

    case 'add_func':
      return driver.addFunc?.(change.F) ?? []

    case 'drop_func':
      return driver.dropFunc?.(change.F) ?? []

    case 'add_trigger':
      return driver.addTrigger?.(change.T) ?? []

    case 'drop_trigger':
      return driver.dropTrigger?.(change.T) ?? []

    case 'add_sequence':
      return driver.addSequence?.(change.S) ?? []

    case 'drop_sequence':
      return driver.dropSequence?.(change.S) ?? []

    case 'modify_sequence':
      return driver.modifySequence?.(change.from, change.to) ?? []

    default:
      return []
  }
}

/**
 * Apply error that exposes how many changes were applied before failure.
 */
export class ApplyError extends Error {
  readonly applied: number

  constructor(message: string, applied: number) {
    super(message)
    this.name = 'ApplyError'
    this.applied = applied
  }
}
