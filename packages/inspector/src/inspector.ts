// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: cmd/atlas-wasi/main.go

import type { DatabaseAdapter } from './adapter.ts'
import { createRestoreFunc, snapshot } from './internal/dev.ts'
import { realmDiff } from './internal/diff.ts'
import type { PlanDriver } from './internal/plan.ts'
import { changeToSQL, detachCycles, sortChanges } from './internal/plan.ts'
import type { DiffDriver } from './internal/sqlx.ts'
import { scanStmts } from './migrate/lex.ts'
import { extractTagsFromStmts } from './migrate/tag.ts'
import { MysqlDiff } from './mysql/diff.ts'
import { MysqlInspector } from './mysql/inspect.ts'
import { MysqlPlan } from './mysql/migrate.ts'
import { CrdbDiff, CrdbInspector } from './postgres/crdb.ts'
import { PostgresDiff } from './postgres/diff.ts'
import { PostgresInspector } from './postgres/inspect.ts'
import { PostgresPlan } from './postgres/migrate.ts'
import type { ExecQuerier, ExecResult, Inspector, QueryResult } from './schema/inspect.ts'
import type { Change } from './schema/migrate.ts'
import type { Column, Realm, Rename, RenameCandidate, Table } from './schema/schema.ts'
import { SqliteDiff } from './sqlite/diff.ts'
import { SqliteInspector } from './sqlite/inspect.ts'
import { SqlitePlan } from './sqlite/migrate.ts'
// -- Types --

export interface InspectorOptions {
  db: DatabaseAdapter
  dialect: 'postgres' | 'mysql' | 'sqlite'
  /** Optional: CockroachDB mode (uses crdb variant of postgres) */
  crdb?: boolean
  /** Optional: TiDB mode (uses tidb variant of mysql) */
  tidb?: boolean
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
      normalizeSchemas?: boolean
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
  constructor(db: DatabaseAdapter) {
    this.db = db
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

// -- System Schema Filtering --

/** System schemas to exclude per dialect. */
const SYSTEM_SCHEMAS: Record<string, Set<string>> = {
  postgres: new Set(['information_schema', 'pg_catalog', 'pg_toast']),
  mysql: new Set(['information_schema', 'mysql', 'performance_schema', 'sys']),
  sqlite: new Set(),
}

function filterSystemSchemas(realm: Realm, dialect: string): Realm {
  const systemSchemas = SYSTEM_SCHEMAS[dialect] ?? new Set()
  if (systemSchemas.size === 0) return realm

  const filtered = realm.schemas.filter((s) => {
    // Postgres: also filter pg_temp_* schemas
    if (dialect === 'postgres' && s.name.startsWith('pg_temp_')) return false
    return !systemSchemas.has(s.name)
  })

  return { ...realm, schemas: filtered }
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
  const q = dialect === 'mysql' ? (s: string) => `\`${s}\`` : (s: string) => `"${s}"`

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
          stmts.push(`ALTER TABLE ${q(r.table)} RENAME COLUMN ${q(r.oldName)} TO ${q(r.newName)}`)
        }
        break
      }
      case 'table': {
        const table = findTableInRealm(fromRealm, r.oldName)
        if (table) {
          table.name = r.newName
          stmts.push(`ALTER TABLE ${q(r.oldName)} RENAME TO ${q(r.newName)}`)
        }
        break
      }
    }
  }

  return stmts
}

function findTableInRealm(realm: Realm, name: string): Table | undefined {
  for (const s of realm.schemas) {
    for (const t of s.tables ?? []) {
      if (t.name === name) return t
    }
  }
  return undefined
}

function findColumnInRealm(realm: Realm, tableName: string, colName: string): Column | undefined {
  const table = findTableInRealm(realm, tableName)
  if (!table) return undefined
  return table.columns.find((c) => c.name === colName)
}

// -- Schema Normalization --

function normalizeSchemaNames(realm: Realm, dialect: string, schemaName?: string): string {
  const def = dialect === 'sqlite' ? 'main' : 'public'
  const strip = new Set([def])
  if (schemaName) strip.add(schemaName)

  for (const s of realm.schemas) {
    if (strip.has(s.name)) {
      s.name = def
    }
  }

  return def
}

// -- Create Dialect Components --

function createComponents(
  dialect: string,
  db: DatabaseAdapter,
  opts: InspectorOptions,
): { inspector: Inspector; differ: DiffDriver; planner: PlanDriver } {
  const eq = new ExecQuerierAdapter(db)

  switch (dialect) {
    case 'postgres':
      if (opts.crdb) {
        return {
          inspector: new CrdbInspector(db),
          differ: new CrdbDiff(),
          planner: new PostgresPlan(),
        }
      }
      return {
        inspector: new PostgresInspector(db),
        differ: new PostgresDiff(),
        planner: new PostgresPlan(),
      }
    case 'mysql': {
      // TiDB uses the same inspector with minor dialect patches
      const inspector = opts.tidb
        ? new MysqlInspector(eq) // TiDB uses MysqlInspector with version detection
        : new MysqlInspector(eq)
      return {
        inspector,
        differ: new MysqlDiff(),
        planner: new MysqlPlan(),
      }
    }
    case 'sqlite':
      return {
        inspector: new SqliteInspector(eq),
        differ: new SqliteDiff(),
        planner: new SqlitePlan(),
      }
    default:
      throw new Error(`Unsupported dialect: "${dialect}"`)
  }
}

// -- Main Factory --

/**
 * Create an InspectorRunner -- the TypeScript replacement for the Atlas WASI binary.
 *
 * This replaces:
 * - packages/db/src/runner.ts (createAtlasRunner)
 * - packages/db/src/worker.ts (WASI worker)
 * - packages/db/src/bridge.ts (SharedArrayBuffer bridge)
 * - packages/db/src/wasi-host.ts (WASI host functions)
 * - packages/db/wasm/atlas.wasm (15MB WASM binary)
 *
 * With direct async TypeScript calls to DatabaseAdapter.
 */
export async function createInspector(options: InspectorOptions): Promise<InspectorRunner> {
  const { db, dialect } = options
  const { inspector, differ, planner } = createComponents(dialect, db, options)
  const eq = new ExecQuerierAdapter(db)

  // Create a diff+apply function for the general restore path (matches Go Atlas)
  async function diffAndApply(current: Realm, desired: Realm): Promise<void> {
    let changes = realmDiff(differ, current, desired)
    if (changes.length === 0) return
    changes = detachCycles(changes)
    changes = sortChanges(changes)
    // MySQL: disable FK checks during apply (drops may reference other tables)
    if (dialect === 'mysql') await eq.exec('SET FOREIGN_KEY_CHECKS = 0')
    try {
      for (const change of changes) {
        const stmts = changeToSQL(planner, change)
        for (const stmt of stmts) {
          await eq.exec(stmt)
        }
      }
    } finally {
      if (dialect === 'mysql') await eq.exec('SET FOREIGN_KEY_CHECKS = 1')
    }
  }

  // Capture initial dev DB state for snapshot/restore pattern (matches Go Atlas Snapshot)
  const initialRealm = await inspector.inspectRealm()
  const restore = createRestoreFunc(eq, inspector, initialRealm, dialect, diffAndApply)

  return {
    async inspect(files, opts) {
      if (files.length === 0) {
        // No files -- inspect existing database state
        let realm = await inspector.inspectRealm(opts?.schema ? { schemas: [opts.schema] } : undefined)
        realm = filterSystemSchemas(realm, dialect)
        return { schema: realm }
      }

      // Execute SQL files against dev DB and inspect (with restore after)
      const realm = await snapshot(eq, inspector, files, {
        schema: opts?.schema,
        dialect,
        restore,
      })
      const filtered = filterSystemSchemas(realm, dialect)

      // Extract and apply tags from original SQL comments
      applyTags(filtered, files, opts?.fileNames)

      return { schema: filtered }
    },

    async diff(from, to, opts) {
      let fromRealm: Realm
      let toRealm: Realm

      // Inspect "from" side
      if (Array.isArray(from)) {
        if (from.length === 0) {
          // Empty from: inspect the dev DB's existing state (e.g. public schema exists)
          fromRealm = await inspector.inspectRealm()
          fromRealm = filterSystemSchemas(fromRealm, dialect)
        } else {
          fromRealm = await snapshot(eq, inspector, from, {
            schema: opts?.fromSchema,
            dialect,
            restore,
          })
          fromRealm = filterSystemSchemas(fromRealm, dialect)
        }
      } else {
        // Live database connection
        const fromInspector = createComponents(dialect, from, options).inspector
        fromRealm = await fromInspector.inspectRealm(opts?.fromSchema ? { schemas: [opts.fromSchema] } : undefined)
        fromRealm = filterSystemSchemas(fromRealm, dialect)
      }

      // Inspect "to" side
      if (Array.isArray(to)) {
        if (to.length === 0) {
          toRealm = await inspector.inspectRealm()
          toRealm = filterSystemSchemas(toRealm, dialect)
        } else {
          toRealm = await snapshot(eq, inspector, to, {
            schema: opts?.toSchema,
            dialect,
            restore,
          })
          toRealm = filterSystemSchemas(toRealm, dialect)
        }
      } else {
        const toInspector = createComponents(dialect, to, options).inspector
        toRealm = await toInspector.inspectRealm(opts?.toSchema ? { schemas: [opts.toSchema] } : undefined)
        toRealm = filterSystemSchemas(toRealm, dialect)
      }

      // Normalize schema names if requested
      let defaultSchema = opts?.defaultSchema
      if (opts?.normalizeSchemas) {
        const def = normalizeSchemaNames(fromRealm, dialect, opts.fromSchema)
        normalizeSchemaNames(toRealm, dialect, opts.toSchema)
        if (!defaultSchema) defaultSchema = def
      }

      // Apply known renames
      let renameStmts: string[] = []
      if (opts?.renames && opts.renames.length > 0) {
        renameStmts = applyKnownRenames(fromRealm, opts.renames, dialect)
      }

      // Detect rename candidates before diffing
      const renameCandidates = detectRenameCandidates(fromRealm, toRealm, opts?.renames)

      // Compute diff
      let changes = realmDiff(differ, fromRealm, toRealm)

      if (changes.length === 0 && renameStmts.length === 0) {
        return { renameCandidates, changes }
      }

      // Sort changes by dependency (schemas first, then topological sort)
      changes = detachCycles(changes)
      changes = sortChanges(changes)

      // Generate SQL statements from changes
      const diffStmts: string[] = []
      for (const change of changes) {
        const sql = changeToSQL(planner, change)
        diffStmts.push(...sql)
      }

      // Strip default schema qualifier from output if requested
      let statements = [...renameStmts, ...diffStmts]
      if (defaultSchema) {
        const prefix = dialect === 'mysql' ? `\`${defaultSchema}\`.` : `"${defaultSchema}".`
        statements = statements.map((s) => s.split(prefix).join(''))
      }

      return { statements, changes, renameCandidates }
    },

    async close() {
      await db.close()
    },
  }
}
