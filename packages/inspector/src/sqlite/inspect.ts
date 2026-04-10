// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/sqlite/inspect.go, sql/sqlite/driver_oss.go

import { modeInspectRealm, modeInspectSchema, validString } from '../internal/sqlx.ts'
import type { ExecQuerier, InspectOptions, InspectRealmOption } from '../schema/inspect.ts'
import { InspectMode, NotExistError } from '../schema/inspect.ts'
import type {
  Attr,
  Check,
  Column,
  ColumnType,
  ForeignKey,
  Index,
  IndexPart,
  Realm,
  Schema,
  Table,
  Trigger,
  View,
} from '../schema/schema.ts'
import {
  type AutoIncrement,
  type CreateStmt,
  columnsQuery,
  databasesQuery,
  databasesQueryArgs,
  defaultExpr,
  type FileAttr,
  fksQuery,
  hasAttr,
  type IndexOrigin,
  type IndexPredicate,
  indexColumnsQuery,
  indexesQuery,
  mainFile,
  parseTriggerMeta,
  parseType,
  type Strict,
  scanExpr,
  tablesQuery,
  triggersQuery,
  viewDef,
  viewsQuery,
  type WithoutRowID,
} from './driver.ts'

// -- SQLite Inspector --

/**
 * SQLite schema inspector.
 * Implements the Inspector interface using sqlite_master and PRAGMA queries.
 */
export class SqliteInspector {
  private db: ExecQuerier
  constructor(db: ExecQuerier) {
    this.db = db
  }

  /**
   * Inspect a single schema by name.
   * If name is empty, the "main" database is used.
   */
  async inspectSchema(name: string, opts?: InspectOptions): Promise<Schema> {
    if (name === '') name = mainFile

    const schemas = await this.databases({ schemas: [name] })
    if (schemas.length === 0) {
      throw new NotExistError(`sqlite: schema "${name}" was not found`)
    }

    const mode = modeInspectSchema(opts)
    const schema = schemas[0]

    if (mode & InspectMode.InspectTables) {
      const tables = await this.tables(opts)
      schema.tables = tables
      for (const t of tables) {
        await this.inspectTable(t)
      }
      this.linkSchemaTables([schema])
    }

    if (mode & InspectMode.InspectViews) {
      await this.inspectViews(schema)
    }

    if (mode & InspectMode.InspectTriggers) {
      await this.inspectTriggers(schema)
    }

    return schema
  }

  /** Inspect the entire realm (all schemas/databases). */
  async inspectRealm(opts?: InspectRealmOption): Promise<Realm> {
    const schemas = await this.databases(opts)
    if (schemas.length > 1) {
      throw new Error(`sqlite: multiple database files are not supported by the driver. got: ${schemas.length}`)
    }

    const mode = modeInspectRealm(opts)

    if (mode & InspectMode.InspectTables) {
      for (const s of schemas) {
        const tables = await this.tables()
        s.tables = tables
        for (const t of tables) {
          await this.inspectTable(t)
        }
      }
      this.linkSchemaTables(schemas)
    }

    if (mode & InspectMode.InspectViews) {
      for (const s of schemas) {
        await this.inspectViews(s)
      }
    }

    if (mode & InspectMode.InspectTriggers) {
      for (const s of schemas) {
        await this.inspectTriggers(s)
      }
    }

    return { schemas }
  }

  // -- Private Inspection Methods --

  /** Inspect a single table (columns, indexes, FKs, checks). */
  private async inspectTable(t: Table): Promise<void> {
    await this.columns(t)
    await this.indexes(t)
    await this.fks(t)
    this.fillChecks(t)
  }

  /** Query and append columns for a table. */
  private async columns(t: Table): Promise<void> {
    const query = columnsQuery.replace('%s', t.name)
    const result = await this.db.query(query)
    for (const row of result.rows) {
      this.addColumn(t, row)
    }
    this.autoinc(t)
  }

  /** Add a single column from a query row. */
  private addColumn(t: Table, row: Record<string, unknown>): void {
    const name = String(row.name ?? '')
    const typeName = String(row.type ?? '')
    const nullable = Boolean(row.nullable)
    const dflt = row.dflt_value
    const pk = Boolean(row.pk)
    const hidden = Number(row.hidden ?? 0)

    const colType: ColumnType = {
      type: parseType(typeName),
      raw: typeName,
    }
    // Only set null if true (match Go omitempty)
    if (nullable) colType.null = true
    const col: Column = { name, type: colType }

    if (dflt != null) {
      col.default = defaultExpr(String(dflt))
    }

    // The hidden flag is set to 2 for VIRTUAL columns, and to
    // 3 for STORED columns. See: sqlite/pragma.c#sqlite3Pragma.
    if (hidden >= 2) {
      this.setGenExpr(t, col, hidden)
    }

    if (!t.columns) t.columns = []
    t.columns.push(col)

    if (pk) {
      if (!t.primaryKey) {
        t.primaryKey = { name: 'PRIMARY', unique: true, parts: [] }
      }
      t.primaryKey.parts.push({ column: name })
    }
  }

  /** Query and append indexes for a table. */
  private async indexes(t: Table): Promise<void> {
    const query = indexesQuery.replace('%s', t.name)
    const result = await this.db.query(query)

    const indexes: Index[] = []
    for (const row of result.rows) {
      const name = String(row.name ?? '')
      const unique = Boolean(row.unique)
      const origin = String(row.origin ?? '')
      const partial = Boolean(row.partial)
      const stmt = String(row.sql ?? '')

      // Skip primary key indexes and internal sqlite_ indexes.
      if (origin === 'pk') continue
      if (name.startsWith('sqlite_')) continue

      const attrs: Attr[] = [
        { kind: 'create_stmt', S: stmt } as CreateStmt,
        { kind: 'index_origin', O: origin } as IndexOrigin,
      ]

      if (partial) {
        const whereIdx = stmt.toUpperCase().indexOf('WHERE')
        if (whereIdx === -1) {
          throw new Error(`missing partial WHERE clause in: ${stmt}`)
        }
        attrs.push({ kind: 'index_predicate', P: stmt.slice(whereIdx + 5).trim() } as IndexPredicate)
      }

      indexes.push({ name, unique, parts: [], attrs })
    }

    // Now fetch column info for each index.
    for (const idx of indexes) {
      await this.indexInfo(t, idx)
    }

    if (indexes.length > 0) {
      t.indexes = indexes
    }
  }

  /** Regex to extract index parts from CREATE INDEX statement. */
  private static reIdxParts = /(?:ON)\s+["`]*(?:\w+)["`]*\s*\((.+?)\)(\s*WHERE\s+.+)?$/i
  private static reIdxDesc = /\s+DESC\s*$/i

  /** Fetch column info for a single index. */
  private async indexInfo(t: Table, idx: Index): Promise<void> {
    const query = indexColumnsQuery.replace('%s', idx.name ?? '')
    const result = await this.db.query(query)

    let hasExpr = false
    for (const row of result.rows) {
      const name = row.name != null ? String(row.name) : null
      const desc = Boolean(row.desc)

      const part: IndexPart = { desc: desc || undefined }

      if (name && validString(name)) {
        // Find matching column in table
        const col = t.columns?.find((c) => c.name === name)
        if (col) {
          part.column = col.name
        } else {
          throw new Error(`sqlite: column "${name}" was not found for index "${idx.name}"`)
        }
      } else if (!validString(name)) {
        // NULL or empty name indicates an expression-based index part.
        hasExpr = true
        part.expr = '<unsupported>'
      } else {
        throw new Error(`sqlite: column "${name}" was not found for index "${idx.name}"`)
      }

      idx.parts.push(part)
    }

    if (!hasExpr) return

    // Try to extract expression parts from CREATE INDEX statement.
    const createStmt = hasAttr<CreateStmt>(idx.attrs, 'create_stmt')
    if (!createStmt || !SqliteInspector.reIdxParts.test(createStmt.S)) return

    const match = SqliteInspector.reIdxParts.exec(createStmt.S)
    if (!match) return

    let x = match[1]
    for (const p of idx.parts) {
      const j = exprLastIndex(x)
      if (j === -1) return

      if (p.expr === '<unsupported>') {
        let kx = x.slice(0, j + 1).trim()
        if (p.desc) {
          kx = kx.replace(SqliteInspector.reIdxDesc, '')
        }
        p.expr = kx
      }
      x = x.slice(j + 1).replace(/^[, ]+/, '')
    }
  }

  /** Query and append foreign keys for a table. */
  private async fks(t: Table): Promise<void> {
    const query = fksQuery.replace('%s', t.name)
    const result = await this.db.query(query)

    const ids = new Map<number, ForeignKey>()
    for (const row of result.rows) {
      const id = Number(row.id)
      const column = String(row.from ?? '')
      const refColumn = String(row.to ?? '')
      const refTable = String(row.table ?? '')
      const updateRule = String(row.on_update ?? '')
      const deleteRule = String(row.on_delete ?? '')

      let fk = ids.get(id)
      if (!fk) {
        fk = {
          symbol: String(id),
          columns: [],
          refTable,
          refColumns: [],
          onUpdate: updateRule as any,
          onDelete: deleteRule as any,
        }
        if (refTable === t.name) {
          fk.refTable = t.name
        }
        ids.set(id, fk)
        if (!t.foreignKeys) t.foreignKeys = []
        t.foreignKeys.push(fk)
      }

      // Add column if not already present.
      if (!fk.columns.includes(column)) {
        fk.columns.push(column)
      }
      if (!fk.refColumns.includes(refColumn)) {
        fk.refColumns.push(refColumn)
      }
    }

    // Fill constraint names from CREATE TABLE statement.
    this.fillConstName(t)
  }

  /** Query and append views to a schema. */
  private async inspectViews(s: Schema): Promise<void> {
    const result = await this.db.query(viewsQuery)
    for (const row of result.rows) {
      const name = String(row.name ?? '')
      const stmt = String(row.sql ?? '')
      const v: View = {
        name,
        def: viewDef(stmt),
        schema: s.name,
      }
      if (!s.views) s.views = []
      s.views.push(v)
    }
  }

  /** Query and append triggers to a schema. */
  private async inspectTriggers(s: Schema): Promise<void> {
    const result = await this.db.query(triggersQuery)
    for (const row of result.rows) {
      const name = String(row.name ?? '')
      const tblName = String(row.tbl_name ?? '')
      const stmt = String(row.sql ?? '')

      const meta = parseTriggerMeta(stmt)
      const trigger: Trigger = {
        name,
        body: stmt,
        timing: meta.timing,
        events: meta.events,
        forEach: meta.forEach,
      }

      // Attach to the owning table.
      let attached = false
      for (const tbl of s.tables ?? []) {
        if (tbl.name === tblName) {
          trigger.table = tbl.name
          if (!tbl.triggers) tbl.triggers = []
          tbl.triggers.push(trigger)
          attached = true
          break
        }
      }

      // If not on a table, check views.
      if (!attached) {
        for (const v of s.views ?? []) {
          if (v.name === tblName) {
            // Trigger is on a view.
            trigger.table = v.name
            break
          }
        }
      }
    }
  }

  /** Query the list of database files (schemas). */
  private async databases(opts?: InspectRealmOption): Promise<Schema[]> {
    let query = databasesQuery
    const args: unknown[] = []

    if (opts?.schemas && opts.schemas.length > 0) {
      const placeholders = opts.schemas.map(() => '?').join(', ')
      query = databasesQueryArgs.replace('%s', placeholders)
      args.push(...opts.schemas)
    }

    const result = await this.db.query(query, args)
    const schemas: Schema[] = []
    for (const row of result.rows) {
      const name = String(row.name ?? '')
      const file = String(row.file ?? '') || ':memory:'
      schemas.push({
        name,
        attrs: [{ kind: 'file', name: file } as FileAttr],
      })
    }
    return schemas
  }

  /** Query the list of tables. */
  private async tables(opts?: InspectOptions): Promise<Table[]> {
    let query = tablesQuery
    const args: unknown[] = []

    if (opts?.tables && opts.tables.length > 0) {
      query += ` AND sqlite_master.name IN (${opts.tables.map(() => '?').join(', ')})`
      args.push(...opts.tables)
    }

    const result = await this.db.query(query, args)
    const tables: Table[] = []
    for (const row of result.rows) {
      const name = String(row.name ?? '')
      const stmt = String(row.sql ?? '').trim()
      const wr = Boolean(row.wr)
      const strict = Boolean(row.strict)

      const attrs: Attr[] = [{ kind: 'create_stmt', S: stmt } as CreateStmt]
      if (wr) attrs.push({ kind: 'without_rowid' } as WithoutRowID)
      if (strict) attrs.push({ kind: 'strict' } as Strict)

      tables.push({ name, columns: [], attrs })
    }
    return tables
  }

  // -- Regex patterns for FK and CHECK constraint extraction --

  private static reFKC =
    /(?:[(,]\s*)["`]*(\w+)["`]*[^,]*\s+CONSTRAINT\s+["`]*(\w+)["`]*\s+REFERENCES\s+["`]*(\w+)["`]*\s*\(([,"` \w]+)\)/gi
  private static reFKT =
    /CONSTRAINT\s+["`]*(\w+)["`]*\s+FOREIGN\s+KEY\s*\(([,"` \w]+)\)\s+REFERENCES\s+["`]*(\w+)["`]*\s*\(([,"` \w]+)\)/gi
  private static reCheck = /(?:CONSTRAINT\s+["`]?(\w+)["`]?\s+)?CHECK\s*\(/gi
  private static reAutoinc = /(?:[(,]\s*)["`]?(\w+)["`]?\s+INTEGER\s+[^,]*PRIMARY\s+KEY\s+[^,]*AUTOINCREMENT/i

  /** Fill FK constraint names from CREATE TABLE statement. */
  private fillConstName(t: Table): void {
    const createStmt = hasAttr<CreateStmt>(t.attrs, 'create_stmt')
    if (!createStmt) return

    // Loop over table constraints.
    SqliteInspector.reFKT.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = SqliteInspector.reFKT.exec(createStmt.S)) !== null) {
      if (m.length !== 5) continue
      const constraintName = m[1]
      const cols = splitColumns(m[2])
      const refTableName = m[3]
      const refCols = splitColumns(m[4])

      for (const fk of t.foreignKeys ?? []) {
        if (matchFK(fk, cols, refTableName, refCols)) {
          fk.symbol = constraintName
          break
        }
      }
    }

    // Loop over inlined column constraints.
    SqliteInspector.reFKC.lastIndex = 0
    while ((m = SqliteInspector.reFKC.exec(createStmt.S)) !== null) {
      if (m.length !== 5) continue
      const colName = m[1]
      const constraintName = m[2]
      const refTableName = m[3]
      const refCols = splitColumns(m[4])

      for (const fk of t.foreignKeys ?? []) {
        if (matchFK(fk, [colName], refTableName, refCols)) {
          fk.symbol = constraintName
          break
        }
      }
    }
  }

  /** Extract CHECK constraints from CREATE TABLE SQL. */
  private fillChecks(t: Table): void {
    const createStmt = hasAttr<CreateStmt>(t.attrs, 'create_stmt')
    if (!createStmt) return

    const sql = createStmt.S
    SqliteInspector.reCheck.lastIndex = 0

    for (let i = 0; i < sql.length; ) {
      SqliteInspector.reCheck.lastIndex = i
      const m = SqliteInspector.reCheck.exec(sql)
      if (!m) break

      const matchEnd = m.index + m[0].length
      // Scan the expression starting from the opening paren.
      const expr = scanExpr(sql.slice(matchEnd - 1))
      if (!expr) break

      const check: Check = { expr }
      // If constraint name was captured.
      if (m[1]) {
        check.name = m[1]
      }

      if (!t.checks) t.checks = []
      t.checks.push(check)

      i = matchEnd + expr.length - 1
    }
  }

  /** Check for AUTOINCREMENT in CREATE TABLE statement. */
  private autoinc(t: Table): void {
    const createStmt = hasAttr<CreateStmt>(t.attrs, 'create_stmt')
    if (!createStmt) return

    if (!t.primaryKey || t.primaryKey.parts.length !== 1) return

    const matches = SqliteInspector.reAutoinc.exec(createStmt.S)
    if (!matches || matches.length !== 2) return

    const pkColName = matches[1]
    const pkCol = t.columns?.find((c) => c.name === pkColName)
    if (!pkCol) return

    // Verify PK matches this column.
    if (t.primaryKey.parts[0].column !== pkColName) return

    const inc: AutoIncrement = { kind: 'autoincrement' }
    // Annotate table PK and column with AUTOINCREMENT.
    if (!t.primaryKey.attrs) t.primaryKey.attrs = []
    t.primaryKey.attrs.push(inc)
    if (!pkCol.attrs) pkCol.attrs = []
    pkCol.attrs.push(inc)
  }

  /** Set generated expression on a column from CREATE TABLE statement. */
  private setGenExpr(t: Table, c: Column, hidden: number): void {
    const createStmt = hasAttr<CreateStmt>(t.attrs, 'create_stmt')
    if (!createStmt) return

    const re = new RegExp(`(?:[(,]\\s*)["\`]*(?:${c.name})["\`]*[^,]*(?:GENERATED\\s+ALWAYS)*\\s*(?:AS){1}\\s*\\(`, 'i')
    const match = re.exec(createStmt.S)
    if (!match) return

    const matchEnd = match.index + match[0].length
    const expr = scanExpr(createStmt.S.slice(matchEnd - 1))
    if (!expr) return

    const typ = hidden === 3 ? 'STORED' : 'VIRTUAL'
    if (!c.attrs) c.attrs = []
    c.attrs.push({ kind: 'generated', expr, type: typ })
  }

  /** Link foreign key references to actual tables within schemas. */
  private linkSchemaTables(schemas: Schema[]): void {
    // Build lookup map.
    for (const s of schemas) {
      for (const t of s.tables ?? []) {
        for (const fk of t.foreignKeys ?? []) {
          // Resolve ref table name to actual table.
          const refTable = s.tables?.find((rt) => rt.name === fk.refTable)
          if (refTable) {
            fk.refTable = refTable.name
          }
        }
      }
    }
  }
}

// -- Helper Functions --

/** Split comma-separated column names, trimming quotes and whitespace. */
function splitColumns(s: string): string[] {
  return s.split(',').map((c) => c.trim().replace(/^[`"]+|[`"]+$/g, ''))
}

/** Check if a FK matches the given columns, ref table, and ref columns. */
function matchFK(fk: ForeignKey, columns: string[], refTable: string, refColumns: string[]): boolean {
  if (fk.columns.length !== columns.length || fk.refTable !== refTable || fk.refColumns.length !== refColumns.length) {
    return false
  }
  for (let i = 0; i < columns.length; i++) {
    if (fk.columns[i] !== columns[i]) return false
  }
  for (let i = 0; i < refColumns.length; i++) {
    if (fk.refColumns[i] !== refColumns[i]) return false
  }
  return true
}

/**
 * Find the last index of a comma-separated expression part.
 * Handles nested parentheses and quoted strings.
 */
function exprLastIndex(x: string): number {
  let depth = 0
  for (let i = 0; i < x.length; i++) {
    switch (x[i]) {
      case '(':
        depth++
        break
      case ')':
        depth--
        break
      case "'":
      case '"': {
        const j = x.indexOf(x[i], i + 1)
        if (j !== -1) i = j
        break
      }
      case ',':
        if (depth === 0) return i - 1
        break
    }
  }
  return x.length - 1
}
