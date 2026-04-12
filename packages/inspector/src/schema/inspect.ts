// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/schema/inspect.go

import type { Realm, Schema } from './schema.ts'

// -- Inspect Mode (bit flags) --

/** Controls the amount and depth of information returned on inspection. */
export const InspectMode = {
  /** Enables schema inspection. */
  InspectSchemas: 1 << 0,
  /** Enables schema tables inspection including all child resources. */
  InspectTables: 1 << 1,
  /** Enables schema views inspection. */
  InspectViews: 1 << 2,
  /** Enables schema functions / procedures inspection. */
  InspectFuncs: 1 << 3,
  /** Enables schema types inspection. */
  InspectTypes: 1 << 4,
  /** Enables inspection of database specific objects like sequences and extensions. */
  InspectObjects: 1 << 5,
  /** Enables schema triggers inspection. */
  InspectTriggers: 1 << 6,
  /** Inspect all resources. */
  InspectAll: (1 << 7) - 1,
} as const
export type InspectMode = number

// -- Inspect Options --

/** Options for schema inspection. */
export interface InspectOptions {
  /** Controls the amount of information returned. If zero, inspects all resources. */
  mode?: InspectMode
  /** Tables to inspect. Empty means all tables in the schema. */
  tables?: string[]
  /** Glob patterns to include resources. If non-empty, only matching resources are considered. */
  include?: string[]
  /** Glob patterns to exclude resources from inspection. */
  exclude?: string[]
}

/** Options for realm inspection. */
export interface InspectRealmOption {
  /** Controls the amount of information returned. If zero, inspects all resources. */
  mode?: InspectMode
  /** Schemas to inspect. Empty means all schemas in the realm. */
  schemas?: string[]
  /** Glob patterns to include resources. */
  include?: string[]
  /** Glob patterns to exclude resources from inspection. */
  exclude?: string[]
}

// -- Error Types --

/** Wraps another error to signal that a schema does not exist. */
export class NotExistError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotExistError'
  }
}

/** Reports if an error is a NotExistError. */
export function isNotExistError(err: unknown): err is NotExistError {
  return err instanceof NotExistError
}

// -- Core Interfaces --

/**
 * Inspector is the interface implemented by dialect drivers for inspecting
 * schema or databases.
 */
export interface Inspector {
  /**
   * Returns the schema description by its name. An empty name means the
   * "attached schema" (e.g. SCHEMA() in MySQL or CURRENT_SCHEMA() in PostgreSQL).
   * A NotExistError is thrown if the schema does not exist in the database.
   */
  inspectSchema(name: string, opts?: InspectOptions): Promise<Schema>

  /** Returns the description of the connected database. */
  inspectRealm(opts?: InspectRealmOption): Promise<Realm>

  /** Returns the current/default schema name for this connection. */
  currentSchema(): Promise<string>
}

/**
 * Differ is the interface implemented by dialect drivers for comparing
 * and diffing schema top elements.
 */
export interface Differ {
  /** Returns a diff report for migrating a schema from state "from" to state "to". */
  schemaDiff(from: Schema, to: Schema, opts?: DiffOptions): Change[]

  /** Returns a diff report for migrating a realm from state "from" to state "to". */
  realmDiff(from: Realm, to: Realm, opts?: DiffOptions): Change[]

  /** Returns a diff report for migrating a table from state "from" to state "to". */
  tableDiff(from: Table, to: Table, opts?: DiffOptions): Change[]
}

/**
 * Normalizer is the interface implemented by dialect drivers for "normalizing"
 * schema objects -- converting schema objects defined in natural form to their
 * representation in the database. Two schema objects are equal if their normal
 * forms are equal.
 */
export interface Normalizer {
  /** Returns the normal representation of a schema. */
  normalizeSchema(schema: Schema): Promise<Schema>

  /** Returns the normal representation of a database. */
  normalizeRealm(realm: Realm): Promise<Realm>
}

// -- Diff Options --

import type { Change } from './migrate.ts'
import type { Table } from './schema.ts'

/** Diff mode controls how the differ processes objects. */
export const DiffMode = {
  /** Default, no flags set. */
  Unset: 0,
  /** Diff objects are considered to be in not-normalized state. */
  NotNormalized: 1 << 0,
  /** Diff objects are considered to be in normalized state. */
  Normalized: 1 << 1,
  /** Invalid changes are skipped instead of returning an error. */
  SkipInvalid: 1 << 2,
} as const
export type DiffMode = number

/** Options for the schema diffing process. */
export interface DiffOptions {
  /** A list of change types to skip. */
  skipChanges?: Change[]
  /** The diffing mode. */
  mode?: DiffMode
}

// -- Query Interface --

/** Result of a query operation. */
export interface QueryResult {
  rows: Record<string, unknown>[]
}

/** Result of an exec operation. */
export interface ExecResult {
  rowsAffected?: number
}

/**
 * ExecQuerier combines query and exec capabilities.
 * This maps to the Go ExecQuerier used by dialect drivers
 * and mirrors DatabaseAdapter from @sqldoc/db.
 */
export interface ExecQuerier {
  query(sql: string, args?: unknown[]): Promise<QueryResult>
  exec(sql: string, args?: unknown[]): Promise<ExecResult>
}
