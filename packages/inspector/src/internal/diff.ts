// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/internal/sqlx/diff.go

import { findColumn, findForeignKey, findFunc, findIndex, findProc, findSequence, findTable } from '../schema/dsl.ts'
import type { DiffOptions } from '../schema/inspect.ts'
import type { Change } from '../schema/migrate.ts'
import { ChangeKind } from '../schema/migrate.ts'
import type {
  Attr,
  Check,
  ForeignKey,
  Func,
  Index,
  Policy,
  Proc,
  Realm,
  Schema,
  Sequence,
  Table,
  Trigger,
  View,
} from '../schema/schema.ts'
import type { DiffDriver } from './sqlx.ts'

// -- Generic Diff Engine --

/**
 * Compute changes between two schemas.
 * Uses DiffDriver for dialect-specific comparison logic.
 */
export function schemaDiff(driver: DiffDriver, from: Schema, to: Schema, opts?: DiffOptions): Change[] {
  if (from.name !== to.name && !opts?.matchDefaultSchemas) {
    throw new Error(`mismatched schema names: "${from.name}" != "${to.name}"`)
  }
  const changes: Change[] = []

  // Schema attribute changes
  const attrChanges = driver.schemaAttrDiff(from, to)
  if (attrChanges.length > 0) {
    changes.push({ type: 'modify_schema', S: to, changes: attrChanges })
  }

  // Schema object changes
  const objChanges = driver.schemaObjectDiff(from, to, opts)
  changes.push(...objChanges)

  // Drop or modify tables
  for (const t1 of from.tables ?? []) {
    const t2 = findTable(to, t1.name)
    if (!t2) {
      changes.push({ type: 'drop_table', T: t1 })
      continue
    }
    const tableChanges = tableDiff(driver, t1, t2, opts)
    if (tableChanges.length > 0) {
      changes.push({ type: 'modify_table', T: t2, changes: tableChanges })
    }
    // Trigger diff
    const triggerChanges = triggerDiff(driver, t1.triggers ?? [], t2.triggers ?? [], opts)
    changes.push(...triggerChanges)
  }

  // Add tables
  for (const t1 of to.tables ?? []) {
    if (!findTable(from, t1.name)) {
      changes.push(...addTableChanges(t1))
    }
  }

  // Drop or modify views
  for (const v1 of from.views ?? []) {
    const v2 = findViewByMaterialized(to, v1)
    if (!v2) {
      changes.push({ type: 'drop_view', V: v1 })
      continue
    }
    const viewChanges = viewDiff(driver, v1, v2, opts)
    changes.push(...viewChanges)
    // View trigger diff
    const vTriggerChanges = triggerDiff(driver, [], [], opts)
    changes.push(...vTriggerChanges)
  }

  // Add views
  for (const v1 of to.views ?? []) {
    if (!findViewByMaterialized(from, v1)) {
      changes.push(...addViewChanges(v1))
    }
  }

  // Drop or modify functions
  for (const f1 of from.funcs ?? []) {
    const f2 = findFunc(to, f1.name)
    if (!f2) {
      changes.push({ type: 'drop_func', F: f1 })
      continue
    }
    if (funcChanged(f1, f2)) {
      changes.push({ type: 'modify_func', from: f1, to: f2 })
    }
  }

  // Add functions
  for (const f1 of to.funcs ?? []) {
    if (!findFunc(from, f1.name)) {
      changes.push({ type: 'add_func', F: f1 })
    }
  }

  // Drop or modify procedures
  for (const p1 of from.procs ?? []) {
    const p2 = findProc(to, p1.name)
    if (!p2) {
      changes.push({ type: 'drop_proc', P: p1 })
      continue
    }
    if (procChanged(p1, p2)) {
      changes.push({ type: 'modify_proc', from: p1, to: p2 })
    }
  }

  // Add procedures
  for (const p1 of to.procs ?? []) {
    if (!findProc(from, p1.name)) {
      changes.push({ type: 'add_proc', P: p1 })
    }
  }

  // Drop or modify sequences
  for (const s1 of from.sequences ?? []) {
    const s2 = findSequence(to, s1.name)
    if (!s2) {
      changes.push({ type: 'drop_sequence', S: s1 })
      continue
    }
    if (sequenceChanged(s1, s2)) {
      changes.push({ type: 'modify_sequence', from: s1, to: s2 })
    }
  }

  // Add sequences
  for (const s1 of to.sequences ?? []) {
    if (!findSequence(from, s1.name)) {
      changes.push({ type: 'add_sequence', S: s1 })
    }
  }

  return changes
}

/**
 * Compute changes between two realms.
 */
export function realmDiff(driver: DiffDriver, from: Realm, to: Realm, opts?: DiffOptions): Change[] {
  const changes: Change[] = []
  const matchDefaults = opts?.matchDefaultSchemas ?? false

  // Realm-level object changes
  const realmObjChanges = driver.realmObjectDiff(from, to, opts)
  changes.push(...realmObjChanges)

  // Build schema matching: pair from-schemas to to-schemas.
  // When matchDefaultSchemas is true, default schemas match each other even if names differ.
  const matchedTo = new Set<string>()

  function findMatchingSchema(s1: Schema): Schema | undefined {
    // Exact name match first
    const exact = to.schemas.find((s) => s.name === s1.name)
    if (exact) return exact
    // Default schema equivalence: from's default matches to's default
    if (matchDefaults && from.defaultSchema && to.defaultSchema && s1.name === from.defaultSchema) {
      return to.schemas.find((s) => s.name === to.defaultSchema)
    }
    return undefined
  }

  // Drop or modify schemas
  for (const s1 of from.schemas) {
    const s2 = findMatchingSchema(s1)
    if (!s2) {
      changes.push({ type: 'drop_schema', S: s1 })
      continue
    }
    matchedTo.add(s2.name)
    const schemaChanges = schemaDiff(driver, s1, s2, opts)
    changes.push(...schemaChanges)
  }

  // Add schemas
  for (const s1 of to.schemas) {
    if (matchedTo.has(s1.name)) continue
    if (!from.schemas.find((s) => s.name === s1.name)) {
      changes.push({ type: 'add_schema', S: s1 })
      // Add all schema-level objects (enums, composites, domains, extensions, sequences)
      for (const e of s1.enums ?? []) {
        changes.push({ type: 'add_object', O: e } as any)
      }
      for (const ct of s1.compositeTypes ?? []) {
        changes.push({ type: 'add_object', O: ct } as any)
      }
      // Domains, range types, and aggregates are stored in attrs
      for (const a of (s1.attrs ?? []) as any[]) {
        if (a?.kind === 'domain' || a?.kind === 'range_type' || a?.kind === 'aggregate') {
          changes.push({ type: 'add_object', O: a } as any)
        }
      }
      // Extensions are handled at realm level by realmObjectDiff — skip here
      for (const seq of s1.sequences ?? []) {
        changes.push({ type: 'add_sequence', S: seq })
      }
      // Add functions, procedures, tables, views
      for (const f of s1.funcs ?? []) {
        changes.push({ type: 'add_func', F: f })
      }
      for (const p of s1.procs ?? []) {
        changes.push({ type: 'add_proc', P: p })
      }
      for (const t of s1.tables ?? []) {
        changes.push(...addTableChanges(t))
      }
      for (const v of s1.views ?? []) {
        changes.push(...addViewChanges(v))
      }
    }
  }

  return changes
}

// -- Table Diff --

/**
 * Compute changes between two tables.
 */
export function tableDiff(driver: DiffDriver, from: Table, to: Table, opts?: DiffOptions): Change[] {
  const changes: Change[] = []

  // Table attribute changes (collations, checks, etc.)
  const attrChanges = driver.tableAttrDiff(from, to, opts)
  changes.push(...attrChanges)

  // Column diff
  changes.push(...columnDiff(driver, from, to, opts))

  // Primary key diff
  changes.push(...pkDiff(driver, from, to, opts))

  // Index diff
  changes.push(...indexDiff(driver, from, to, opts))

  // Foreign key diff
  const matchedFKs = new Set<string>()
  for (const fk1 of from.foreignKeys ?? []) {
    let fk2 = findForeignKey(to, fk1.symbol ?? '')
    if (!fk2) {
      // System-named FK: try structural match
      fk2 = findSimilarForeignKey(to, fk1)
    }
    if (!fk2) {
      changes.push({ type: 'drop_foreign_key', F: fk1 })
      continue
    }
    matchedFKs.add(fk2.symbol ?? '')
    const fkChangeKind = fkChange(driver, fk1, fk2)
    if (fkChangeKind !== ChangeKind.NoChange) {
      changes.push({ type: 'modify_foreign_key', from: fk1, to: fk2, change: fkChangeKind })
    }
  }
  for (const fk1 of to.foreignKeys ?? []) {
    if (matchedFKs.has(fk1.symbol ?? '')) continue
    if (!findForeignKey(from, fk1.symbol ?? '')) {
      changes.push({ type: 'add_foreign_key', F: fk1 })
    }
  }

  // Check constraint diff
  changes.push(...checkDiff(from, to, opts))

  // Policy diff
  changes.push(...policyDiff(from, to, opts))

  return changes
}

// -- Column Diff --

function columnDiff(driver: DiffDriver, from: Table, to: Table, opts?: DiffOptions): Change[] {
  const changes: Change[] = []

  // Drop or modify columns
  for (const c1 of from.columns) {
    const c2 = findColumn(to, c1.name)
    if (!c2) {
      changes.push({ type: 'drop_column', C: c1 })
      continue
    }
    const change = driver.columnChange(from, c1, c2, opts)
    if (change) {
      changes.push(change)
    }
  }

  // Add columns
  for (const c1 of to.columns) {
    if (!findColumn(from, c1.name)) {
      changes.push({ type: 'add_column', C: c1 })
    }
  }

  return changes
}

// -- Primary Key Diff --

function pkDiff(driver: DiffDriver, from: Table, to: Table, _opts?: DiffOptions): Change[] {
  const pk1 = from.primaryKey
  const pk2 = to.primaryKey
  const changes: Change[] = []

  if (!pk1 && pk2) {
    changes.push({ type: 'add_primary_key', P: pk2 })
  } else if (pk1 && !pk2) {
    changes.push({ type: 'drop_primary_key', P: pk1 })
  } else if (pk1 && pk2) {
    let change = indexChange(driver, pk1, pk2)
    // Mask out unique change for PKs (always unique)
    change &= ~ChangeKind.ChangeUnique
    if (change !== ChangeKind.NoChange) {
      changes.push({ type: 'modify_primary_key', from: pk1, to: pk2, change })
    } else if (pk1.name && pk2.name && pk1.name !== pk2.name) {
      // Skip rename when both sides have system-generated names (e.g. MSSQL PK__table__hex)
      const bothGenerated = driver.isGeneratedIndexName(from, pk1) && driver.isGeneratedIndexName(to, pk2)
      if (!bothGenerated) {
        changes.push({
          type: 'rename_constraint',
          from: pk1 as unknown as Record<string, unknown>,
          to: pk2 as unknown as Record<string, unknown>,
        })
      }
    }
  }

  return changes
}

// -- Index Diff --

function indexDiff(driver: DiffDriver, from: Table, to: Table, _opts?: DiffOptions): Change[] {
  const changes: Change[] = []
  const matched = new Set<string>()

  // Drop or modify indexes
  for (const idx1 of from.indexes ?? []) {
    const idx2 = findIndex(to, idx1.name ?? '')
    if (idx2) {
      const change = indexChange(driver, idx1, idx2)
      if (change !== ChangeKind.NoChange) {
        changes.push({ type: 'modify_index', from: idx1, to: idx2, change })
      }
      matched.add(idx2.name ?? '')
      continue
    }
    // Check for generated index names (unnamed indexes)
    if (idx1.name && driver.isGeneratedIndexName(from, idx1)) {
      const similar = findSimilarUnnamedIndex(driver, to, idx1)
      if (similar) {
        matched.add(similar.name ?? '')
        continue
      }
    }
    changes.push({ type: 'drop_index', I: idx1 })
  }

  // Add indexes
  for (const idx of to.indexes ?? []) {
    if (matched.has(idx.name ?? '')) continue
    if (!findIndex(from, idx.name ?? '')) {
      changes.push({ type: 'add_index', I: idx })
    }
  }

  return changes
}

/** Compute change kind for an index. */
function indexChange(driver: DiffDriver, from: Index, to: Index): ChangeKind {
  let change = ChangeKind.NoChange
  if (from.unique !== to.unique) {
    change |= ChangeKind.ChangeUnique
  }
  if (driver.indexAttrChanged(from.attrs ?? [], to.attrs ?? [])) {
    change |= ChangeKind.ChangeAttr
  }
  change |= partsChange(driver, from, to)
  change |= commentChange(from.attrs, to.attrs)
  return change
}

/** Compare index parts. */
function partsChange(driver: DiffDriver, from: Index, to: Index): ChangeKind {
  const fromParts = from.parts
  const toParts = to.parts
  if (fromParts.length !== toParts.length) {
    return ChangeKind.ChangeParts
  }
  for (let i = 0; i < fromParts.length; i++) {
    const fp = fromParts[i]
    const tp = toParts[i]
    if (fp.desc !== tp.desc || driver.indexPartAttrChanged(from, to, i)) {
      return ChangeKind.ChangeParts
    }
    if (fp.column && tp.column) {
      if (fp.column !== tp.column) return ChangeKind.ChangeParts
    } else if (fp.expr && tp.expr) {
      if (fp.expr !== tp.expr) return ChangeKind.ChangeParts
    } else {
      // Mismatched column vs expression
      return ChangeKind.ChangeParts
    }
  }
  return ChangeKind.NoChange
}

/** Search for an unnamed index with the same index-parts. */
function findSimilarUnnamedIndex(driver: DiffDriver, table: Table, idx1: Index): Index | undefined {
  for (const idx2 of table.indexes ?? []) {
    // Match against unnamed indexes or indexes that are also system-named
    const isUnnamed = idx2.name === '' || idx2.name === undefined
    const isAlsoSystemNamed = idx2.name && driver.isGeneratedIndexName(table, idx2)
    if (isUnnamed || isAlsoSystemNamed) {
      if (idx1.unique === idx2.unique && partsChange(driver, idx1, idx2) === ChangeKind.NoChange) {
        return idx2
      }
    }
  }
  return undefined
}

/** Find a structurally equivalent FK in a table, ignoring constraint names. Used for system-named FKs. */
function findSimilarForeignKey(table: Table, fk1: ForeignKey): ForeignKey | undefined {
  for (const fk2 of table.foreignKeys ?? []) {
    if (
      fk1.refTable === fk2.refTable &&
      fk1.columns.length === fk2.columns.length &&
      fk1.columns.every((c, i) => c === fk2.columns[i]) &&
      fk1.refColumns.every((c, i) => c === fk2.refColumns[i])
    ) {
      return fk2
    }
  }
  return undefined
}

// -- Foreign Key Diff --

function fkChange(driver: DiffDriver, from: ForeignKey, to: ForeignKey): ChangeKind {
  let change = ChangeKind.NoChange

  // Check ref table
  if (from.refTable !== to.refTable) {
    change |= ChangeKind.ChangeRefTable | ChangeKind.ChangeRefColumn
  } else if (from.refColumns.length !== to.refColumns.length) {
    change |= ChangeKind.ChangeRefColumn
  } else {
    for (let i = 0; i < from.refColumns.length; i++) {
      if (from.refColumns[i] !== to.refColumns[i]) {
        change |= ChangeKind.ChangeRefColumn
      }
    }
  }

  // Check columns
  if (from.columns.length !== to.columns.length) {
    change |= ChangeKind.ChangeColumn
  } else {
    for (let i = 0; i < from.columns.length; i++) {
      if (from.columns[i] !== to.columns[i]) {
        change |= ChangeKind.ChangeColumn
      }
    }
  }

  // Check reference actions
  if (driver.referenceChanged(from.onUpdate, to.onUpdate)) {
    change |= ChangeKind.ChangeUpdateAction
  }
  if (driver.referenceChanged(from.onDelete, to.onDelete)) {
    change |= ChangeKind.ChangeDeleteAction
  }
  if (driver.foreignKeyAttrChanged(from.attrs ?? [], to.attrs ?? [])) {
    change |= ChangeKind.ChangeAttr
  }

  return change
}

// -- Check Constraint Diff --

function checkDiff(from: Table, to: Table, _opts?: DiffOptions): Change[] {
  const changes: Change[] = []
  const fromChecks = from.checks ?? []
  const toChecks = to.checks ?? []

  // Build maps: by name and by expression (for system-named checks)
  const toByName = new Map<string, Check>()
  const toByExpr = new Map<string, Check>()
  for (const c of toChecks) {
    if (c.name) toByName.set(c.name, c)
    toByExpr.set(c.expr, c)
  }
  const fromByName = new Map<string, Check>()
  const fromByExpr = new Map<string, Check>()
  for (const c of fromChecks) {
    if (c.name) fromByName.set(c.name, c)
    fromByExpr.set(c.expr, c)
  }

  // Drop or modify checks
  const matched = new Set<string>()
  for (const c1 of fromChecks) {
    // Try matching by name first
    let c2 = c1.name ? toByName.get(c1.name) : undefined
    // Fallback: match by expression (handles system-named constraints with different hex suffixes)
    if (!c2) c2 = toByExpr.get(c1.expr)
    if (!c2) {
      changes.push({ type: 'drop_check', C: c1 })
      continue
    }
    matched.add(c2.expr)
    if (c1.expr !== c2.expr) {
      changes.push({ type: 'modify_check', from: c1, to: c2, change: ChangeKind.ChangeAttr })
    }
  }

  // Add checks
  for (const c1 of toChecks) {
    if (matched.has(c1.expr)) continue
    if (c1.name && fromByName.has(c1.name)) continue
    if (fromByExpr.has(c1.expr)) continue
    changes.push({ type: 'add_check', C: c1 })
  }

  return changes
}

// -- Policy Diff --

function policyDiff(from: Table, to: Table, _opts?: DiffOptions): Change[] {
  const changes: Change[] = []
  const fromPolicies = from.policies ?? []
  const toPolicies = to.policies ?? []

  const toMap = new Map<string, Policy>()
  for (const p of toPolicies) toMap.set(p.name, p)
  const fromMap = new Map<string, Policy>()
  for (const p of fromPolicies) fromMap.set(p.name, p)

  // Drop or modify policies
  for (const p1 of fromPolicies) {
    const p2 = toMap.get(p1.name)
    if (!p2) {
      changes.push({ type: 'drop_policy', P: p1 })
      continue
    }
    if (policyChanged(p1, p2)) {
      changes.push({ type: 'modify_policy', from: p1, to: p2 })
    }
  }

  // Add policies
  for (const p1 of toPolicies) {
    if (!fromMap.has(p1.name)) {
      changes.push({ type: 'add_policy', P: p1 })
    }
  }

  return changes
}

function policyChanged(a: Policy, b: Policy): boolean {
  return (
    a.permissive !== b.permissive ||
    a.using !== b.using ||
    a.check !== b.check ||
    a.cmd !== b.cmd ||
    JSON.stringify(a.roles ?? []) !== JSON.stringify(b.roles ?? [])
  )
}

// -- Trigger Diff --

function triggerDiff(_driver: DiffDriver, from: Trigger[], to: Trigger[], _opts?: DiffOptions): Change[] {
  const changes: Change[] = []
  const toMap = new Map<string, Trigger>()
  for (const t of to) toMap.set(t.name, t)
  const fromMap = new Map<string, Trigger>()
  for (const t of from) fromMap.set(t.name, t)

  for (const t1 of from) {
    const t2 = toMap.get(t1.name)
    if (!t2) {
      changes.push({ type: 'drop_trigger', T: t1 })
      continue
    }
    if (triggerChanged(t1, t2)) {
      changes.push({ type: 'modify_trigger', from: t1, to: t2 })
    }
  }

  for (const t1 of to) {
    if (!fromMap.has(t1.name)) {
      changes.push({ type: 'add_trigger', T: t1 })
    }
  }

  return changes
}

function triggerChanged(a: Trigger, b: Trigger): boolean {
  return (
    a.body !== b.body ||
    a.timing !== b.timing ||
    a.forEach !== b.forEach ||
    JSON.stringify(a.events ?? []) !== JSON.stringify(b.events ?? [])
  )
}

// -- View Diff --

function viewDiff(driver: DiffDriver, from: View, to: View, _opts?: DiffOptions): Change[] {
  const changes: Change[] = []
  const attrChanges = driver.viewAttrChanges(from, to)
  const defChanged = from.def !== to.def

  if (attrChanges.length > 0 || defChanged) {
    changes.push({ type: 'modify_view', from, to, changes: attrChanges })
  }

  return changes
}

// -- Helpers --

function funcChanged(a: Func, b: Func): boolean {
  return a.body !== b.body || a.lang !== b.lang || JSON.stringify(a.args ?? []) !== JSON.stringify(b.args ?? [])
}

function procChanged(a: Proc, b: Proc): boolean {
  return a.body !== b.body || a.lang !== b.lang || JSON.stringify(a.args ?? []) !== JSON.stringify(b.args ?? [])
}

function sequenceChanged(a: Sequence, b: Sequence): boolean {
  return (
    a.start !== b.start ||
    a.increment !== b.increment ||
    a.min !== b.min ||
    a.max !== b.max ||
    a.cache !== b.cache ||
    a.cycle !== b.cycle
  )
}

/** Generate add-table changes (table + triggers). */
function addTableChanges(t: Table): Change[] {
  const changes: Change[] = [{ type: 'add_table', T: t }]
  for (const tr of t.triggers ?? []) {
    changes.push({ type: 'add_trigger', T: tr })
  }
  return changes
}

/** Generate add-view changes (view + triggers). */
function addViewChanges(v: View): Change[] {
  const changes: Change[] = [{ type: 'add_view', V: v }]
  return changes
}

/** Find a view matching both name and materialized status. */
function findViewByMaterialized(s: Schema, v: View): View | undefined {
  return s.views?.find((v2) => v2.name === v.name && v2.materialized === v.materialized)
}

/** Check if a comment attribute changed. Returns the ChangeKind. */
function commentChange(from: Attr[] | undefined, to: Attr[] | undefined): ChangeKind {
  const c1 = from?.find((a) => 'kind' in a && (a as any).kind === 'comment') as { text: string } | undefined
  const c2 = to?.find((a) => 'kind' in a && (a as any).kind === 'comment') as { text: string } | undefined
  if (c1?.text !== c2?.text) {
    return ChangeKind.ChangeComment
  }
  return ChangeKind.NoChange
}

/**
 * Sort changes for safe execution order.
 * Drops before adds, FK drops before table drops, etc.
 */
export function sortChanges(changes: Change[]): Change[] {
  const order: Record<string, number> = {
    // Drops first (in reverse dependency order)
    drop_foreign_key: 0,
    drop_trigger: 1,
    drop_index: 2,
    drop_policy: 3,
    drop_check: 4,
    drop_view: 5,
    drop_table: 6,
    drop_func: 7,
    drop_proc: 8,
    drop_sequence: 9,
    drop_schema: 10,
    // Modifications
    modify_schema: 20,
    modify_sequence: 21,
    modify_func: 22,
    modify_proc: 23,
    modify_table: 24,
    modify_view: 25,
    modify_trigger: 26,
    modify_policy: 27,
    // Adds last (in dependency order)
    add_schema: 30,
    add_sequence: 31,
    add_func: 32,
    add_proc: 33,
    add_table: 34,
    add_view: 35,
    add_index: 36,
    add_check: 37,
    add_policy: 38,
    add_trigger: 39,
    add_foreign_key: 40,
    // Columns within table
    drop_column: 50,
    modify_column: 51,
    add_column: 52,
    // PK
    drop_primary_key: 53,
    modify_primary_key: 54,
    add_primary_key: 55,
    // Renames
    rename_table: 60,
    rename_column: 61,
    rename_index: 62,
    rename_constraint: 63,
  }

  return [...changes].sort((a, b) => {
    const oa = order[a.type] ?? 100
    const ob = order[b.type] ?? 100
    return oa - ob
  })
}

/**
 * Detach cyclic foreign key references by separating FK creation
 * from table creation.
 */
export function detachCycles(changes: Change[]): Change[] {
  const planned: Change[] = []
  const deferred: Change[] = []

  for (const change of changes) {
    if (change.type === 'add_table') {
      const t = change.T
      const selfFKs: ForeignKey[] = []
      const extFKs: ForeignKey[] = []

      for (const fk of t.foreignKeys ?? []) {
        if (fk.refTable === t.name) {
          selfFKs.push(fk)
        } else {
          extFKs.push(fk)
        }
      }

      if (extFKs.length > 0) {
        // Defer external FK creation
        const fkChanges: Change[] = extFKs.map((fk) => ({ type: 'add_foreign_key' as const, F: fk }))
        deferred.push({ type: 'modify_table', T: t, changes: fkChanges })
        // Create table with only self-referencing FKs
        const tCopy = { ...t, foreignKeys: selfFKs.length > 0 ? selfFKs : undefined }
        planned.push({ type: 'add_table', T: tCopy })
      } else {
        planned.push(change)
      }
    } else if (change.type === 'drop_table') {
      const t = change.T
      const extFKs: ForeignKey[] = []

      for (const fk of t.foreignKeys ?? []) {
        if (fk.refTable !== t.name) {
          extFKs.push(fk)
        }
      }

      if (extFKs.length > 0) {
        // Drop external FKs before dropping table
        const fkChanges: Change[] = extFKs.map((fk) => ({ type: 'drop_foreign_key' as const, F: fk }))
        planned.push({ type: 'modify_table', T: t, changes: fkChanges })
        const tCopy = { ...t, foreignKeys: undefined }
        planned.push({ type: 'drop_table', T: tCopy })
      } else {
        planned.push(change)
      }
    } else {
      planned.push(change)
    }
  }

  return [...planned, ...deferred]
}
