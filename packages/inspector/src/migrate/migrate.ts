// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/migrate/migrate.go
//
// The migrate-layer interfaces (ExecQuerier, Inspector, Differ, etc.) intentionally
// differ from the schema inspection layer. They model migration execution concerns
// and are re-exported with Migrate* prefixes (e.g. MigrateInspector) via index.ts.

import type { Realm } from '../schema/schema.ts'

// -- Plan --

/** A migration plan with statements grouped by table/object. */
export interface Plan {
  /** Version of the plan. */
  version?: string
  /** Name of the plan. */
  name?: string
  /** Whether the changeset is reversible. */
  reversible?: boolean
  /** Whether the changeset is transactional. */
  transactional: boolean
  /** The list of changes in the plan. */
  changes: PlanChange[]
  /** Delimiter to use for separating statements. */
  delimiter?: string
  /** Directives to add to the file. */
  directives?: string[]
}

/** A single change in a migration plan. */
export interface PlanChange {
  /** The SQL statement. */
  cmd: string
  /** Human-readable description. */
  comment?: string
  /** Reverse SQL statement (for rollback). */
  reverse?: string
  /** Multiple reverse statements (for rollback). */
  reverseStmts?: string[]
}

// -- ExecQuerier --

/** Interface for executing SQL queries. */
export interface ExecQuerier {
  exec(sql: string): Promise<void>
  query(sql: string): Promise<unknown[]>
}

// -- Inspector --

/** Interface for inspecting database schemas. */
export interface Inspector {
  inspectRealm(db: ExecQuerier): Promise<Realm>
}

// -- Differ --

/** Interface for computing schema diffs. */
export interface Differ {
  diff(from: Realm, to: Realm): PlanChange[]
}

// -- Normalizer --

/** Interface for normalizing schemas. */
export interface Normalizer {
  normalize(realm: Realm): Realm
}

// -- PlanApplier --

/** Interface for applying migration plans. */
export interface PlanApplier {
  apply(db: ExecQuerier, plan: Plan): Promise<void>
}

// -- Driver --

/** Driver combines inspection, diffing, and plan application. */
export interface Driver {
  inspector: Inspector
  differ: Differ
  planApplier: PlanApplier
  normalizer?: Normalizer
}

// -- Snapshoter --

/** Snapshoter interface for capturing schema state. */
export interface Snapshoter {
  snapshot(db: ExecQuerier): Promise<Realm>
}
