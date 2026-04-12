// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/schema/migrate.go

import type {
  Attr,
  Check,
  Column,
  ForeignKey,
  Func,
  Index,
  Policy,
  Proc,
  Schema,
  Sequence,
  Table,
  Trigger,
  View,
} from './schema.ts'

// -- Clauses --

/** Clause that indicates IF EXISTS semantics. */
export interface IfExists {
  type: 'if_exists'
}

/** Clause that indicates IF NOT EXISTS semantics. */
export interface IfNotExists {
  type: 'if_not_exists'
}

/** Clause that indicates CASCADE semantics for DROP statements. */
export interface Cascade {
  type: 'cascade'
}

/** A clause carried by schema changes for additional information. */
export type Clause = IfExists | IfNotExists | Cascade

// -- ChangeKind (bit flags for what changed) --

/** Describes a change kind that can be combined using a set of flags. */
export const ChangeKind = {
  NoChange: 0,

  // Common changes
  ChangeAttr: 1 << 0,
  ChangeCharset: 1 << 1,
  ChangeCollate: 1 << 2,
  ChangeComment: 1 << 3,

  // Column specific changes
  ChangeNull: 1 << 4,
  ChangeType: 1 << 5,
  ChangeDefault: 1 << 6,
  ChangeGenerated: 1 << 7,

  // Index specific changes
  ChangeUnique: 1 << 8,
  ChangeParts: 1 << 9,

  // Foreign key specific changes
  ChangeColumn: 1 << 10,
  ChangeRefColumn: 1 << 11,
  ChangeRefTable: 1 << 12,
  ChangeUpdateAction: 1 << 13,
  ChangeDeleteAction: 1 << 14,
} as const
export type ChangeKind = number

// -- Schema Changes --

export interface AddSchema {
  type: 'add_schema'
  S: Schema
  extra?: Clause[]
}

export interface DropSchema {
  type: 'drop_schema'
  S: Schema
  extra?: Clause[]
}

export interface ModifySchema {
  type: 'modify_schema'
  S: Schema
  changes: Change[]
}

// -- Table Changes --

export interface AddTable {
  type: 'add_table'
  T: Table
  extra?: Clause[]
}

export interface DropTable {
  type: 'drop_table'
  T: Table
  extra?: Clause[]
}

export interface ModifyTable {
  type: 'modify_table'
  T: Table
  changes: Change[]
}

export interface RenameTable {
  type: 'rename_table'
  from: Table
  to: Table
}

// -- View Changes --

export interface AddView {
  type: 'add_view'
  V: View
  extra?: Clause[]
}

export interface DropView {
  type: 'drop_view'
  V: View
  extra?: Clause[]
}

export interface ModifyView {
  type: 'modify_view'
  from: View
  to: View
  changes?: Change[]
}

export interface RenameView {
  type: 'rename_view'
  from: View
  to: View
}

// -- Function Changes --

export interface AddFunc {
  type: 'add_func'
  F: Func
  extra?: Clause[]
}

export interface DropFunc {
  type: 'drop_func'
  F: Func
  extra?: Clause[]
}

export interface ModifyFunc {
  type: 'modify_func'
  from: Func
  to: Func
  changes?: Change[]
}

export interface RenameFunc {
  type: 'rename_func'
  from: Func
  to: Func
}

// -- Procedure Changes --

export interface AddProc {
  type: 'add_proc'
  P: Proc
  extra?: Clause[]
}

export interface DropProc {
  type: 'drop_proc'
  P: Proc
  extra?: Clause[]
}

export interface ModifyProc {
  type: 'modify_proc'
  from: Proc
  to: Proc
  changes?: Change[]
}

export interface RenameProc {
  type: 'rename_proc'
  from: Proc
  to: Proc
}

// -- Object Changes (generic) --

export interface AddObject {
  type: 'add_object'
  O: Record<string, unknown>
  extra?: Clause[]
}

export interface DropObject {
  type: 'drop_object'
  O: Record<string, unknown>
  extra?: Clause[]
}

export interface ModifyObject {
  type: 'modify_object'
  from: Record<string, unknown>
  to: Record<string, unknown>
}

export interface RenameObject {
  type: 'rename_object'
  from: Record<string, unknown>
  to: Record<string, unknown>
}

// -- Trigger Changes --

export interface AddTrigger {
  type: 'add_trigger'
  T: Trigger
  extra?: Clause[]
}

export interface DropTrigger {
  type: 'drop_trigger'
  T: Trigger
  extra?: Clause[]
}

export interface ModifyTrigger {
  type: 'modify_trigger'
  from: Trigger
  to: Trigger
  changes?: Change[]
}

export interface RenameTrigger {
  type: 'rename_trigger'
  from: Trigger
  to: Trigger
}

// -- Column Changes --

export interface AddColumn {
  type: 'add_column'
  C: Column
}

export interface DropColumn {
  type: 'drop_column'
  C: Column
}

export interface ModifyColumn {
  type: 'modify_column'
  from: Column
  to: Column
  change: ChangeKind
  extra?: Clause[]
}

export interface RenameColumn {
  type: 'rename_column'
  from: Column
  to: Column
}

// -- Index Changes --

export interface AddIndex {
  type: 'add_index'
  I: Index
  extra?: Clause[]
}

export interface DropIndex {
  type: 'drop_index'
  I: Index
  extra?: Clause[]
}

export interface ModifyIndex {
  type: 'modify_index'
  from: Index
  to: Index
  change: ChangeKind
  extra?: Clause[]
}

export interface RenameIndex {
  type: 'rename_index'
  from: Index
  to: Index
}

// -- Primary Key Changes --

export interface AddPrimaryKey {
  type: 'add_primary_key'
  P: Index
}

export interface DropPrimaryKey {
  type: 'drop_primary_key'
  P: Index
}

export interface ModifyPrimaryKey {
  type: 'modify_primary_key'
  from: Index
  to: Index
  change: ChangeKind
}

// -- Foreign Key Changes --

export interface AddForeignKey {
  type: 'add_foreign_key'
  F: ForeignKey
  extra?: Clause[]
}

export interface DropForeignKey {
  type: 'drop_foreign_key'
  F: ForeignKey
  extra?: Clause[]
}

export interface ModifyForeignKey {
  type: 'modify_foreign_key'
  from: ForeignKey
  to: ForeignKey
  change: ChangeKind
}

// -- Check Constraint Changes --

export interface AddCheck {
  type: 'add_check'
  C: Check
  extra?: Clause[]
}

export interface DropCheck {
  type: 'drop_check'
  C: Check
}

export interface ModifyCheck {
  type: 'modify_check'
  from: Check
  to: Check
  change: ChangeKind
}

// -- Sequence Changes --

export interface AddSequence {
  type: 'add_sequence'
  S: Sequence
  extra?: Clause[]
}

export interface DropSequence {
  type: 'drop_sequence'
  S: Sequence
  extra?: Clause[]
}

export interface ModifySequence {
  type: 'modify_sequence'
  from: Sequence
  to: Sequence
  changes?: Change[]
}

// -- Policy Changes --

export interface AddPolicy {
  type: 'add_policy'
  P: Policy
  extra?: Clause[]
}

export interface DropPolicy {
  type: 'drop_policy'
  P: Policy
  extra?: Clause[]
}

export interface ModifyPolicy {
  type: 'modify_policy'
  from: Policy
  to: Policy
  changes?: Change[]
}

// -- Attribute Changes --

export interface AddAttr {
  type: 'add_attr'
  A: Attr
}

export interface DropAttr {
  type: 'drop_attr'
  A: Attr
}

export interface ModifyAttr {
  type: 'modify_attr'
  from: Attr
  to: Attr
}

// -- Constraint Rename --

export interface RenameConstraint {
  type: 'rename_constraint'
  from: Record<string, unknown>
  to: Record<string, unknown>
}

// -- Change Union --

/** Discriminated union of all schema change types. */
export type Change =
  | AddSchema
  | DropSchema
  | ModifySchema
  | AddTable
  | DropTable
  | ModifyTable
  | RenameTable
  | AddView
  | DropView
  | ModifyView
  | RenameView
  | AddFunc
  | DropFunc
  | ModifyFunc
  | RenameFunc
  | AddProc
  | DropProc
  | ModifyProc
  | RenameProc
  | AddObject
  | DropObject
  | ModifyObject
  | RenameObject
  | AddTrigger
  | DropTrigger
  | ModifyTrigger
  | RenameTrigger
  | AddColumn
  | DropColumn
  | ModifyColumn
  | RenameColumn
  | AddIndex
  | DropIndex
  | ModifyIndex
  | RenameIndex
  | AddPrimaryKey
  | DropPrimaryKey
  | ModifyPrimaryKey
  | AddForeignKey
  | DropForeignKey
  | ModifyForeignKey
  | AddCheck
  | DropCheck
  | ModifyCheck
  | AddSequence
  | DropSequence
  | ModifySequence
  | AddPolicy
  | DropPolicy
  | ModifyPolicy
  | AddAttr
  | DropAttr
  | ModifyAttr
  | RenameConstraint

// -- Plan --

/** A migration plan containing a set of changes. */
export interface Plan {
  changes: Change[]
  transactional?: boolean
}

/**
 * PlanApplier is the interface implemented by dialect drivers for planning
 * schema changes into migration steps.
 */
export interface PlanApplier {
  planChanges(from: Schema, to: Schema, changes: Change[]): Plan[]
}

// -- Changes Helper --

/** A list of changes with search and mutation helpers. */
export class Changes extends Array<Change> {
  /** Returns the index of the first AddTable with the given name, or -1. */
  indexAddTable(name: string): number {
    return this.findIndex((c) => c.type === 'add_table' && (c as AddTable).T.name === name)
  }

  /** Returns the index of the first DropTable with the given name, or -1. */
  indexDropTable(name: string): number {
    return this.findIndex((c) => c.type === 'drop_table' && (c as DropTable).T.name === name)
  }

  /** Returns the index of the first AddColumn with the given name, or -1. */
  indexAddColumn(name: string): number {
    return this.findIndex((c) => c.type === 'add_column' && (c as AddColumn).C.name === name)
  }

  /** Returns the index of the first DropColumn with the given name, or -1. */
  indexDropColumn(name: string): number {
    return this.findIndex((c) => c.type === 'drop_column' && (c as DropColumn).C.name === name)
  }

  /** Returns the index of the first ModifyColumn with the given name, or -1. */
  indexModifyColumn(name: string): number {
    return this.findIndex((c) => c.type === 'modify_column' && (c as ModifyColumn).from.name === name)
  }

  /** Returns the index of the first AddIndex with the given name, or -1. */
  indexAddIndex(name: string): number {
    return this.findIndex((c) => c.type === 'add_index' && (c as AddIndex).I.name === name)
  }

  /** Returns the index of the first DropIndex with the given name, or -1. */
  indexDropIndex(name: string): number {
    return this.findIndex((c) => c.type === 'drop_index' && (c as DropIndex).I.name === name)
  }

  /** Removes elements at the given indexes. */
  removeIndexes(...indexes: number[]): void {
    const set = new Set(indexes)
    const filtered = this.filter((_, i) => !set.has(i))
    this.length = 0
    this.push(...filtered)
  }
}
