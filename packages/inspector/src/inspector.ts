// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: original Go runtime entrypoint

import { type DatabaseEngine, type Dialect, defaultSchemaForDialect, quoteIdentifier } from '@sqldoc/core'
import type { DatabaseAdapter, DbSource } from './adapter.ts'
import { filterSystemSchemas, getInspectorRuntime, resolveInspectorEngine } from './dialects.ts'
import { executeFiles } from './internal/dev.ts'
import { realmDiff } from './internal/diff.ts'
import { changeToSQL, detachCycles, sortChanges } from './internal/plan.ts'
import { scanStmts } from './migrate/lex.ts'
import { extractTagsFromStmts } from './migrate/tag.ts'
import type { ExecQuerier, ExecResult, QueryResult } from './schema/inspect.ts'
import type { Change } from './schema/migrate.ts'
import type { Column, Realm, Rename, RenameCandidate, Schema, Table } from './schema/schema.ts'
// -- Types --

export interface InspectorOptions {
  /**
   * Source of fresh empty databases. Every inspect() or diff() operation that
   * needs a working DB calls source.open() for a new one and disposes it when
   * done. Drift-style diffs pass a live DatabaseAdapter as a DiffSource — the
   * live side is inspected in place, no shadow involved.
   */
  source: DbSource
  engine: DatabaseEngine
}

/** Result from the inspector — uses rich Realm types directly. */
export interface InspectorResult {
  schema?: Realm
  statements?: string[]
  changes?: Change[]
  renameCandidates?: RenameCandidate[]
  error?: string
}

export interface InspectorRunner {
  /** Execute SQL files against dev DB, inspect resulting schema, return with tags. */
  inspect(files: string[], options?: { schema?: string; fileNames?: string[] }): Promise<InspectorResult>

  /** Compare two schema states and return migration SQL. */
  diff(
    from: DiffSource,
    to: DiffSource,
    options?: {
      schema?: string
      defaultSchema?: string
      fromSchema?: string
      toSchema?: string
      /** When true, treat default schemas as equivalent even if names differ. */
      matchDefaultSchemas: boolean
      /** When true, strip default schema qualifier from output SQL. */
      stripDefaultSchema: boolean
      /** When true, skip extension add/drop changes. */
      ignoreExtensions?: boolean
      renames?: Rename[]
    },
  ): Promise<InspectorResult>

  /** Clean up resources. */
  close(): Promise<void>
}

export type DiffSource = string[] | DatabaseAdapter

// -- Adapter: wrap DatabaseAdapter to provide ExecQuerier --

/**
 * Wraps a DatabaseAdapter (columns + rows[][]) to provide ExecQuerier interface
 * (rows as Record<string, unknown>[]) needed by MySQL and SQLite inspectors.
 */
class ExecQuerierAdapter implements ExecQuerier {
  private db: DatabaseAdapter
  currentSchema: string
  constructor(db: DatabaseAdapter) {
    this.db = db
    this.currentSchema = db.currentSchema
  }

  async query(sql: string, args?: unknown[]): Promise<QueryResult> {
    const result = await this.db.query(sql, args)
    const rows: Record<string, unknown>[] = []
    for (const row of result.rows) {
      const record: Record<string, unknown> = {}
      for (let i = 0; i < result.columns.length; i++) {
        record[result.columns[i]] = (row as unknown[])[i]
      }
      rows.push(record)
    }
    return { rows }
  }

  async exec(sql: string, args?: unknown[]): Promise<ExecResult> {
    const result = await this.db.exec(sql, args)
    return { rowsAffected: result.rowsAffected }
  }
}

// -- Tag Extraction and Application --

/**
 * Extract tags from SQL file comments and apply them to the inspected realm.
 * Tags are extracted before SQL execution (since comments are lost on execution).
 */
function applyTags(realm: Realm, files: string[], _fileNames?: string[]): void {
  for (let i = 0; i < files.length; i++) {
    const sql = files[i]
    if (!sql.trim()) continue

    const stmtList = scanStmts(sql)
    const idx = extractTagsFromStmts(stmtList)

    // Apply table-level tags
    for (const [key, tags] of Array.from(idx.tableTags.entries())) {
      for (const schema of realm.schemas) {
        for (const table of schema.tables ?? []) {
          const tableKeys = [table.name]
          if (schema.name) tableKeys.push(`${schema.name}.${table.name}`)
          if (tableKeys.includes(key)) {
            if (!table.attrs) table.attrs = []
            table.attrs.push(...tags)
          }
        }
        // Also check views
        for (const view of schema.views ?? []) {
          const viewKeys = [view.name]
          if (schema.name) viewKeys.push(`${schema.name}.${view.name}`)
          if (viewKeys.includes(key)) {
            if (!view.attrs) view.attrs = []
            view.attrs.push(...tags)
          }
        }
      }
    }

    // Apply column-level tags
    for (const [key, tags] of Array.from(idx.columnTags.entries())) {
      for (const schema of realm.schemas) {
        for (const table of schema.tables ?? []) {
          for (const col of table.columns) {
            // key format: "table.column" or "schema.table.column"
            const colKeys = [`${table.name}.${col.name}`]
            if (schema.name) colKeys.push(`${schema.name}.${table.name}.${col.name}`)
            if (colKeys.includes(key)) {
              if (!col.attrs) col.attrs = []
              col.attrs.push(...tags)
            }
          }
        }
      }
    }
  }
}

// -- Rename Detection --

/**
 * Detect potential rename candidates by finding drop+add pairs with matching types.
 */
function detectRenameCandidates(fromRealm: Realm, toRealm: Realm, knownRenames?: Rename[]): RenameCandidate[] {
  const knownSet = new Set<string>()
  for (const r of knownRenames ?? []) {
    if (r.type === 'column') {
      knownSet.add(`${r.table}.${r.oldName}->${r.newName}`)
    } else {
      knownSet.add(`${r.oldName}->${r.newName}`)
    }
  }

  const candidates: RenameCandidate[] = []

  for (const fromSchema of fromRealm.schemas) {
    const toSchema = toRealm.schemas.find((s) => s.name === fromSchema.name)
    if (!toSchema) continue

    // Column rename candidates
    for (const fromTable of fromSchema.tables ?? []) {
      const toTable = (toSchema.tables ?? []).find((t) => t.name === fromTable.name)
      if (!toTable) continue

      const droppedCols = fromTable.columns.filter((fc) => !toTable.columns.some((tc) => tc.name === fc.name))
      const addedCols = toTable.columns.filter((tc) => !fromTable.columns.some((fc) => fc.name === tc.name))

      const usedDropped = new Set<number>()
      const usedAdded = new Set<number>()

      for (let di = 0; di < droppedCols.length; di++) {
        for (let ai = 0; ai < addedCols.length; ai++) {
          if (usedDropped.has(di) || usedAdded.has(ai)) continue
          if (columnsTypeMatch(droppedCols[di], addedCols[ai])) {
            const key = `${fromTable.name}.${droppedCols[di].name}->${addedCols[ai].name}`
            if (knownSet.has(key)) continue
            candidates.push({
              type: 'column',
              table: fromTable.name,
              oldName: droppedCols[di].name,
              newName: addedCols[ai].name,
              colType: droppedCols[di].type?.type?.T,
            })
            usedDropped.add(di)
            usedAdded.add(ai)
          }
        }
      }
    }

    // Table rename candidates: only when exactly 1 drop + 1 add
    const droppedTables = (fromSchema.tables ?? []).filter(
      (ft) => !(toSchema.tables ?? []).some((tt) => tt.name === ft.name),
    )
    const addedTables = (toSchema.tables ?? []).filter(
      (tt) => !(fromSchema.tables ?? []).some((ft) => ft.name === tt.name),
    )

    if (droppedTables.length === 1 && addedTables.length === 1) {
      const key = `${droppedTables[0].name}->${addedTables[0].name}`
      if (!knownSet.has(key)) {
        candidates.push({
          type: 'table',
          table: droppedTables[0].name,
          oldName: droppedTables[0].name,
          newName: addedTables[0].name,
        })
      }
    }
  }

  return candidates
}

function columnsTypeMatch(a: Column, b: Column): boolean {
  if (!a.type?.type || !b.type?.type) return false
  return a.type.type.T === b.type.type.T
}

// -- Known Renames --

/**
 * Apply known renames to the FROM realm and return RENAME SQL statements.
 */
function applyKnownRenames(fromRealm: Realm, renames: Rename[], dialect: string): string[] {
  const stmts: string[] = []
  const defaultSchema = defaultSchemaForDialect(dialect as Dialect) ?? 'public'
  const q = (name: string) => quoteIdentifier(name, dialect as Dialect)

  // Build table rename map for cross-reference
  const tableRenameMap = new Map<string, string>()
  for (const r of renames) {
    if (r.type === 'table') tableRenameMap.set(r.newName, r.oldName)
  }

  for (const r of renames) {
    switch (r.type) {
      case 'column': {
        let tableName = r.table
        let col = findColumnInRealm(fromRealm, tableName, r.oldName)
        if (!col) {
          const oldTable = tableRenameMap.get(tableName)
          if (oldTable) {
            tableName = oldTable
            col = findColumnInRealm(fromRealm, tableName, r.oldName)
          }
        }
        if (col) {
          col.name = r.newName
          const found = findTableInRealm(fromRealm, tableName)
          const schemaPrefix =
            found?.schema.name && found.schema.name !== defaultSchema ? `${q(found.schema.name)}.` : ''
          stmts.push(`ALTER TABLE ${schemaPrefix}${q(tableName)} RENAME COLUMN ${q(r.oldName)} TO ${q(r.newName)}`)
        }
        break
      }
      case 'table': {
        const found = findTableInRealm(fromRealm, r.oldName)
        if (found) {
          found.table.name = r.newName
          const schemaPrefix =
            found.schema.name && found.schema.name !== defaultSchema ? `${q(found.schema.name)}.` : ''
          stmts.push(`ALTER TABLE ${schemaPrefix}${q(r.oldName)} RENAME TO ${q(r.newName)}`)
        }
        break
      }
    }
  }

  return stmts
}

function findTableInRealm(realm: Realm, name: string): { table: Table; schema: Schema } | undefined {
  // Support schema-qualified names (e.g. "audit.users")
  const dotIdx = name.indexOf('.')
  if (dotIdx !== -1) {
    const schemaName = name.slice(0, dotIdx)
    const tableName = name.slice(dotIdx + 1)
    for (const s of realm.schemas) {
      if (s.name !== schemaName) continue
      for (const t of s.tables ?? []) {
        if (t.name === tableName) return { table: t, schema: s }
      }
    }
    return undefined
  }
  // Bare name: search all schemas
  for (const s of realm.schemas) {
    for (const t of s.tables ?? []) {
      if (t.name === name) return { table: t, schema: s }
    }
  }
  return undefined
}

function findColumnInRealm(realm: Realm, tableName: string, colName: string): Column | undefined {
  const result = findTableInRealm(realm, tableName)
  if (!result) return undefined
  return result.table.columns.find((c) => c.name === colName)
}

// -- Inspect a live adapter directly --

/**
 * Inspect a live DatabaseAdapter and return a Realm. Does not own the adapter —
 * the caller is responsible for closing it.
 *
 * Use this for live/prod DB inspection. For SQL files use `runner.inspect(...)`
 * on an `InspectorRunner` backed by a shadow DbSource.
 */
export async function inspectAdapter(
  engine: DatabaseEngine,
  adapter: DatabaseAdapter,
  opts?: { schema?: string },
): Promise<Realm> {
  const resolvedEngine = resolveInspectorEngine({ engine })
  const runtime = getInspectorRuntime(resolvedEngine)
  const liveEq = new ExecQuerierAdapter(adapter)
  const liveInspector = runtime.createComponents(adapter, liveEq).inspector
  const realm = await liveInspector.inspectRealm(opts?.schema ? { schemas: [opts.schema] } : undefined)
  return filterSystemSchemas(realm, resolvedEngine)
}

// -- Pure-TS diff (no DB) --

export interface DiffRealmsOptions {
  defaultSchema?: string
  /** When true, treat default schemas as equivalent even if names differ. */
  matchDefaultSchemas?: boolean
  /** When true, strip default schema qualifier from output SQL. */
  stripDefaultSchema?: boolean
  /** When true, skip extension add/drop changes. Useful when diffing against a real DB that has extensions the schema doesn't declare. */
  ignoreExtensions?: boolean
  renames?: Rename[]
}

/**
 * Run the diff + plan pipeline on two already-inspected Realms. No DB calls.
 *
 * When both realms are available from cache, this is significantly cheaper than
 * `runner.diff(sqlFrom, sqlTo, ...)` which would re-inspect both sides via a
 * live or shadow database.
 *
 * Pure with respect to its inputs — fromRealm/toRealm are deep-cloned before any
 * mutating steps (rename application), so callers can reuse the same Realm
 * across multiple diff calls without state leaking.
 */
export function diffRealms(
  engine: DatabaseEngine,
  fromRealmIn: Realm,
  toRealmIn: Realm,
  opts?: DiffRealmsOptions,
): InspectorResult {
  const resolvedEngine = resolveInspectorEngine({ engine })
  const runtime = getInspectorRuntime(resolvedEngine)
  const { dialect } = runtime
  const { differ, planner } = runtime.createComponents(noDbSentinel(), noExecSentinel())

  // Deep-clone so `applyKnownRenames` and downstream logic can mutate safely.
  let fromRealm: Realm = structuredClone(fromRealmIn)
  let toRealm: Realm = structuredClone(toRealmIn)

  const resolvedDefaultSchema = opts?.defaultSchema
  if (resolvedDefaultSchema) {
    fromRealm = { ...fromRealm, defaultSchema: resolvedDefaultSchema }
    toRealm = { ...toRealm, defaultSchema: resolvedDefaultSchema }
  }

  let renameStmts: string[] = []
  if (opts?.renames && opts.renames.length > 0) {
    renameStmts = applyKnownRenames(fromRealm, opts.renames, dialect)
  }

  const renameCandidates = detectRenameCandidates(fromRealm, toRealm, opts?.renames)

  const diffOpts =
    opts?.matchDefaultSchemas !== undefined || opts?.ignoreExtensions !== undefined
      ? { matchDefaultSchemas: opts?.matchDefaultSchemas ?? false, ignoreExtensions: opts?.ignoreExtensions }
      : undefined
  let changes = realmDiff(differ, fromRealm, toRealm, diffOpts)

  if (changes.length === 0 && renameStmts.length === 0) {
    return { renameCandidates, changes }
  }

  changes = detachCycles(changes)
  changes = sortChanges(changes)

  if (opts?.stripDefaultSchema) {
    planner.defaultSchema = resolvedDefaultSchema ?? fromRealm.defaultSchema
  } else {
    planner.defaultSchema = resolvedDefaultSchema
  }

  const diffStmts: string[] = []
  for (const change of changes) {
    const sql = changeToSQL(planner, change)
    diffStmts.push(...sql)
  }

  planner.defaultSchema = undefined

  const statements = [...renameStmts, ...diffStmts]

  return { statements, changes, renameCandidates }
}

// -- Main Factory --

export async function createInspector(options: InspectorOptions): Promise<InspectorRunner> {
  const { source } = options
  const engine = resolveInspectorEngine(options)
  const runtime = getInspectorRuntime(engine)
  // Differ and planner are pure dialect logic — they don't touch a db. They're
  // built once at runner creation; inspectors are built per-acquired-db below.

  async function inspectSide(side: DiffSource, schema: string | undefined): Promise<Realm> {
    if (!Array.isArray(side)) {
      const liveEq = new ExecQuerierAdapter(side)
      const liveInspector = runtime.createComponents(side, liveEq).inspector
      const realm = await liveInspector.inspectRealm(schema ? { schemas: [schema] } : undefined)
      return filterSystemSchemas(realm, engine)
    }
    const db = await source.open()
    try {
      const eq = new ExecQuerierAdapter(db)
      const inspector = runtime.createComponents(db, eq).inspector
      if (side.length > 0) await executeFiles(eq, side, engine)
      const realm = await inspector.inspectRealm(schema ? { schemas: [schema] } : undefined)
      return filterSystemSchemas(realm, engine)
    } finally {
      await db.close()
    }
  }

  return {
    async inspect(files, opts) {
      const realm = await inspectSide(files, opts?.schema)
      if (files.length > 0) applyTags(realm, files, opts?.fileNames)
      return { schema: realm }
    },

    async diff(from, to, opts) {
      const resolvedFromSchema = opts?.fromSchema ?? opts?.schema
      const resolvedToSchema = opts?.toSchema ?? opts?.schema
      const resolvedDefaultSchema = opts?.defaultSchema ?? opts?.schema

      // Parallel: each side opens its own DB from the source (or reads a live
      // adapter). Independent sandboxes means no synchronization needed.
      const [fromRealm, toRealm] = await Promise.all([
        inspectSide(from, resolvedFromSchema),
        inspectSide(to, resolvedToSchema),
      ])

      return diffRealms(engine, fromRealm, toRealm, {
        defaultSchema: resolvedDefaultSchema,
        matchDefaultSchemas: opts?.matchDefaultSchemas,
        stripDefaultSchema: opts?.stripDefaultSchema,
        ignoreExtensions: opts?.ignoreExtensions,
        renames: opts?.renames,
      })
    },

    async close() {
      await source.close()
    },
  }
}

// -- Sentinels --
//
// runtime.createComponents(db, eq) produces { inspector, differ, planner }.
// The inspector needs db/eq; the differ and planner are pure and don't touch
// them. When the runner only wants differ+planner (built once, reused), we
// pass throwaway stand-ins. Inspectors are built again per-acquisition with
// the real adapter.
function noDbSentinel(): DatabaseAdapter {
  return {
    currentSchema: '',
    async query() {
      return { columns: [], rows: [] }
    },
    async exec() {
      return { rowsAffected: 0 }
    },
    async close() {},
  }
}
function noExecSentinel(): ExecQuerier {
  return {
    currentSchema: '',
    async query() {
      return { rows: [] }
    },
    async exec() {
      return { rowsAffected: 0 }
    },
  }
}
