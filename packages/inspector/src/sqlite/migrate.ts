// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/sqlite/migrate.go, sql/sqlite/driver_oss.go

import type { PlanDriver } from '../internal/plan.ts'
import { Builder, mayWrap } from '../internal/sqlx.ts'
import type { Change, Clause } from '../schema/migrate.ts'
import { ChangeKind } from '../schema/migrate.ts'
import type { Check, Column, ForeignKey, Index, Table, Trigger, View } from '../schema/schema.ts'
import { formatType } from './convert.ts'
import { type AutoIncrement, hasAttr, type IndexPredicate, type Strict, type WithoutRowID } from './driver.ts'

// -- SQLite PlanDriver Implementation --

/**
 * SQLite DDL generation driver.
 * Handles SQLite's limited ALTER TABLE support with the 12-step rebuild procedure.
 */
export class SqlitePlan implements PlanDriver {
  defaultSchema?: string

  private b(): Builder {
    return new Builder({ quoteOpening: '`', quoteClosing: '`', schema: this.defaultSchema })
  }

  /** Generate SQL for creating a table. */
  addTable(table: Table): string[] {
    const stmts: string[] = []
    const b = this.b()
    b.P('CREATE TABLE').Ident(table.name)

    const columnDefs: string[] = []
    for (const col of table.columns) {
      columnDefs.push(columnDef(col))
    }

    // Primary key (unless auto-increment, which is inlined on column).
    if (table.primaryKey && !autoincPK(table.primaryKey)) {
      const parts = table.primaryKey.parts
        .map((p) => {
          let s = quoteIdent(p.column ?? '')
          if (p.desc) s += ' DESC'
          return s
        })
        .join(', ')
      columnDefs.push(`PRIMARY KEY (${parts})`)
    }

    // Foreign keys.
    for (const fk of table.foreignKeys ?? []) {
      columnDefs.push(fkDef(fk))
    }

    // CHECK constraints from attrs.
    for (const chk of table.checks ?? []) {
      columnDefs.push(checkDef(chk))
    }

    const body = columnDefs.map((d) => `  ${d}`).join(',\n')
    let sql = `${b.toString()} (\n${body}\n)`

    // Table options.
    const options: string[] = []
    if (hasAttr<WithoutRowID>(table.attrs, 'without_rowid')) {
      options.push('WITHOUT ROWID')
    }
    if (hasAttr<Strict>(table.attrs, 'strict')) {
      options.push('STRICT')
    }
    if (options.length > 0) {
      sql += ` ${options.join(', ')}`
    }

    stmts.push(sql)

    // Add indexes.
    for (const idx of table.indexes ?? []) {
      stmts.push(...addIndex(table, idx))
    }

    return stmts
  }

  /** Generate SQL for dropping a table. */
  dropTable(table: Table, _extra?: Clause[]): string[] {
    return [`DROP TABLE ${quoteIdent(table.name)}`]
  }

  /**
   * Generate SQL for modifying a table.
   * If modification is simple (add column, add/drop index, rename column),
   * uses ALTER TABLE. Otherwise, uses the 12-step rebuild procedure.
   */
  modifyTable(from: Table, to: Table, changes: Change[]): string[] {
    if (isAlterable(changes)) {
      return this.alterTable(to, changes)
    }
    return this.rebuildTable(from, to, changes)
  }

  /** Generate SQL for creating a view. */
  addView(view: View): string[] {
    return [`CREATE VIEW ${quoteIdent(view.name)} AS ${view.def ?? ''}`]
  }

  /** Generate SQL for dropping a view. */
  dropView(view: View, _extra?: Clause[]): string[] {
    return [`DROP VIEW ${quoteIdent(view.name)}`]
  }

  /** Generate SQL for modifying a view (drop + recreate). */
  modifyView(from: View, to: View): string[] {
    return [`DROP VIEW ${quoteIdent(from.name)}`, `CREATE VIEW ${quoteIdent(to.name)} AS ${to.def ?? ''}`]
  }

  /** Generate SQL for creating a trigger. */
  addTrigger(trigger: Trigger): string[] {
    // SQLite triggers store their full CREATE TRIGGER body.
    if (trigger.body) return [trigger.body]
    return []
  }

  /** Generate SQL for dropping a trigger. */
  dropTrigger(trigger: Trigger, _extra?: Clause[]): string[] {
    return [`DROP TRIGGER IF EXISTS ${quoteIdent(trigger.name)}`]
  }

  // -- Private Methods --

  /**
   * Apply simple table alterations (add column, add/drop/rename index, rename column).
   */
  private alterTable(table: Table, changes: Change[]): string[] {
    const stmts: string[] = []

    for (const change of changes) {
      switch (change.type) {
        case 'add_index':
          stmts.push(...addIndex(table, change.I))
          break

        case 'drop_index':
          stmts.push(`DROP INDEX ${quoteIdent(change.I.name ?? '')}`)
          break

        case 'rename_index':
          // SQLite doesn't support RENAME INDEX; drop and recreate.
          stmts.push(`DROP INDEX ${quoteIdent(change.from.name ?? '')}`)
          stmts.push(...addIndex(table, change.to))
          break

        case 'add_column': {
          const def = columnDef(change.C)
          stmts.push(`ALTER TABLE ${quoteIdent(table.name)} ADD COLUMN ${def}`)
          break
        }

        case 'rename_column':
          stmts.push(
            `ALTER TABLE ${quoteIdent(table.name)} RENAME COLUMN ${quoteIdent(change.from.name)} TO ${quoteIdent(change.to.name)}`,
          )
          break
      }
    }

    return stmts
  }

  /**
   * Generate the 12-step ALTER TABLE rebuild.
   * https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes
   *
   * Steps:
   * 1. Disable foreign keys
   * 2. Create new table with desired schema (temporary name)
   * 3. Copy data from old table
   * 4. Drop old table
   * 5. Rename new table to old name
   * 6. Re-enable foreign keys
   * 7. Recreate indexes
   */
  private rebuildTable(from: Table, to: Table, changes: Change[]): string[] {
    const stmts: string[] = []
    const tmpName = `new_${to.name}`

    // Step 1: Disable foreign keys.
    stmts.push('PRAGMA foreign_keys = off')

    // Step 2: Create new table with temporary name.
    const tmpTable: Table = { ...to, name: tmpName, indexes: undefined }
    const createStmts = this.addTable(tmpTable)
    stmts.push(...createStmts)

    // Step 3: Copy rows from old table to new.
    const { fromCols, toCols } = computeCopyColumns(to, changes)
    if (toCols.length > 0) {
      const toColsStr = toCols.map((c) => quoteIdent(c)).join(', ')
      const fromColsStr = fromCols
        .map((c) => {
          if (c.startsWith('IFNULL(')) return c
          return quoteIdent(c)
        })
        .join(', ')
      stmts.push(
        `INSERT INTO ${quoteIdent(tmpName)} (${toColsStr}) SELECT ${fromColsStr} FROM ${quoteIdent(from.name)}`,
      )
    }

    // Step 4: Drop old table.
    stmts.push(`DROP TABLE ${quoteIdent(from.name)}`)

    // Step 5: Rename new table.
    stmts.push(`ALTER TABLE ${quoteIdent(tmpName)} RENAME TO ${quoteIdent(to.name)}`)

    // Step 6: Recreate indexes.
    for (const idx of to.indexes ?? []) {
      stmts.push(...addIndex(to, idx))
    }

    // Step 7: Re-enable foreign keys.
    stmts.push('PRAGMA foreign_keys = on')

    return stmts
  }
}

// -- Helper Functions --

/** Determine if a table modification can use simple ALTER TABLE. */
function isAlterable(changes: Change[]): boolean {
  for (const change of changes) {
    switch (change.type) {
      case 'rename_column':
      case 'rename_index':
      case 'drop_index':
      case 'add_index':
        break

      case 'add_column': {
        const col = change.C
        // If the column has a DEFAULT with a non-constant value, can't use ALTER.
        if (col.default) {
          if ('X' in col.default) return false // RawExpr
          if ('V' in col.default) {
            const v = col.default.V
            if (['CURRENT_TIME', 'CURRENT_DATE', 'CURRENT_TIMESTAMP'].includes(v)) {
              return false
            }
          }
        }
        // Only VIRTUAL generated columns can be added using ALTER TABLE.
        const gen = col.attrs?.find((a) => 'kind' in a && (a as any).kind === 'generated') as
          | { type?: string }
          | undefined
        if (gen && (gen.type ?? '').toUpperCase() === 'STORED') {
          return false
        }
        break
      }

      default:
        // Any other change type requires rebuild.
        return false
    }
  }
  return true
}

/** Determine if the primary key uses AUTOINCREMENT. */
function autoincPK(pk: Index): boolean {
  if (hasAttr<AutoIncrement>(pk.attrs, 'autoincrement')) return true
  if (pk.parts.length === 1) {
    // Check if the PK column has autoincrement -- we need the column attrs
    // but we only have column name references. Check pk.attrs.
    return false
  }
  return false
}

/**
 * Compute which columns to copy from old table to new table during rebuild.
 * Returns parallel arrays of from/to column names.
 */
function computeCopyColumns(to: Table, changes: Change[]): { fromCols: string[]; toCols: string[] } {
  const fromCols: string[] = []
  const toCols: string[] = []

  for (const column of to.columns) {
    // Skip generated columns (computed automatically).
    if (column.attrs?.some((a) => 'kind' in a && (a as any).kind === 'generated')) {
      continue
    }

    // Find associated change.
    let change: Change | undefined
    for (const c of changes) {
      switch (c.type) {
        case 'add_column':
          if (c.C.name === column.name) change = c
          break
        case 'modify_column':
          if (c.to.name === column.name) change = c
          break
        case 'rename_column':
          if (c.to.name === column.name) change = c
          break
      }
    }

    switch (change?.type) {
      case 'add_column':
        // New columns get their DEFAULT/NULL values automatically.
        break

      case 'modify_column': {
        toCols.push(column.name)
        // If converting nullable to non-nullable with default, use IFNULL.
        if (
          !column.type.null &&
          column.default &&
          (change.change & (ChangeKind.ChangeNull | ChangeKind.ChangeDefault)) !== 0
        ) {
          const defVal = formatDefault(column)
          if (defVal) {
            fromCols.push(`IFNULL(${quoteIdent(column.name)}, ${defVal}) AS ${quoteIdent(column.name)}`)
          } else {
            fromCols.push(column.name)
          }
        } else {
          fromCols.push(column.name)
        }
        break
      }

      case 'rename_column':
        toCols.push(change.to.name)
        fromCols.push(change.from.name)
        break

      default:
        // Unchanged columns: copy as-is.
        toCols.push(column.name)
        fromCols.push(column.name)
        break
    }
  }

  return { fromCols, toCols }
}

/** Generate a CREATE INDEX statement. */
function addIndex(table: Table, idx: Index): string[] {
  let sql = 'CREATE'
  if (idx.unique) sql += ' UNIQUE'
  sql += ' INDEX'
  if (idx.name) sql += ` ${quoteIdent(idx.name)}`
  sql += ` ON ${quoteIdent(table.name)}`

  const parts = idx.parts
    .map((p) => {
      let s = ''
      if (p.column) {
        s = quoteIdent(p.column)
      } else if (p.expr) {
        s = mayWrap(p.expr)
      }
      if (p.desc) s += ' DESC'
      return s
    })
    .join(', ')
  sql += ` (${parts})`

  // Partial index predicate.
  const pred = hasAttr<IndexPredicate>(idx.attrs, 'index_predicate')
  if (pred) {
    sql += ` WHERE ${pred.P}`
  }

  return [sql]
}

/** Generate a column definition string. */
function columnDef(c: Column): string {
  const parts: string[] = [quoteIdent(c.name)]

  try {
    parts.push(formatType(c.type.type))
  } catch {
    // Fallback to raw type string if format fails.
    if (c.type.raw) parts.push(c.type.raw)
  }

  if (!c.type.null) {
    parts.push('NOT NULL')
  } else {
    parts.push('NULL')
  }

  if (c.default) {
    const defVal = formatDefault(c)
    if (defVal) parts.push(`DEFAULT ${defVal}`)
  }

  // AUTOINCREMENT.
  const inc = c.attrs?.find((a) => 'kind' in a && (a as any).kind === 'autoincrement')
  const gen = c.attrs?.find((a) => 'kind' in a && (a as any).kind === 'generated') as
    | { expr: string; type?: string }
    | undefined

  if (inc) {
    parts.push('PRIMARY KEY AUTOINCREMENT')
  } else if (gen) {
    parts.push(`AS ${mayWrap(gen.expr)} ${gen.type ?? 'VIRTUAL'}`)
  }

  return parts.join(' ')
}

/** Generate a FK constraint definition. */
function fkDef(fk: ForeignKey): string {
  const parts: string[] = []
  if (fk.symbol) {
    parts.push(`CONSTRAINT ${quoteIdent(fk.symbol)}`)
  }
  parts.push('FOREIGN KEY')
  parts.push(`(${fk.columns.map((c) => quoteIdent(c)).join(', ')})`)
  parts.push(`REFERENCES ${quoteIdent(fk.refTable)}`)
  parts.push(`(${fk.refColumns.map((c) => quoteIdent(c)).join(', ')})`)
  if (fk.onUpdate) parts.push(`ON UPDATE ${fk.onUpdate}`)
  if (fk.onDelete) parts.push(`ON DELETE ${fk.onDelete}`)
  return parts.join(' ')
}

/** Generate a CHECK constraint definition. */
function checkDef(c: Check): string {
  let expr = c.expr.trim()
  if (!expr.startsWith('(') || !expr.endsWith(')')) {
    expr = `(${expr})`
  }
  if (c.name) {
    return `CONSTRAINT ${quoteIdent(c.name)} CHECK ${expr}`
  }
  return `CHECK ${expr}`
}

/** Format a column's default value for DDL. */
function formatDefault(c: Column): string | undefined {
  if (!c.default) return undefined
  if ('V' in c.default) {
    // Literal value. Numeric/boolean types don't need quotes.
    switch (c.type.type.kind) {
      case 'boolean':
      case 'decimal':
      case 'integer':
      case 'float':
        return c.default.V
      default:
        return singleQuote(c.default.V)
    }
  }
  if ('X' in c.default) {
    return mayWrap(c.default.X)
  }
  return undefined
}

/** Quote an identifier with backticks (SQLite style). */
function quoteIdent(name: string): string {
  return `\`${name}\``
}

/** Wrap a string in single quotes if not already quoted. */
function singleQuote(s: string): string {
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s
  return `'${s.replace(/'/g, "''")}'`
}
