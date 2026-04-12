import type { PlanDriver } from '../internal/plan.ts'
import { Builder } from '../internal/sqlx.ts'
import type { Change } from '../schema/migrate.ts'
import { ChangeKind } from '../schema/migrate.ts'
import type {
  Attr,
  Check,
  Column,
  ForeignKey,
  Func,
  Index,
  Proc,
  Schema,
  Sequence,
  Table,
  Trigger,
  View,
} from '../schema/schema.ts'
import { quote, typeDDL } from './convert.ts'

// -- Helper: find attribute by kind --

function findAttr<T>(attrs: Attr[] | undefined, kind: string): T | undefined {
  if (!attrs) return undefined
  return attrs.find((a) => 'kind' in a && (a as any).kind === kind) as T | undefined
}

// -- MSSQL Builder Factory --

function mssqlBuilder(schema?: string): Builder {
  return new Builder({ quoteOpening: '[', quoteClosing: ']', schema, indent: '  ' })
}

// -- Helper: bracket-quoted table reference --

/** Bracket-quote an identifier for MSSQL, escaping any ] inside. */
function quoteName(s: string): string {
  return `[${s.replaceAll(']', ']]')}]`
}

function tableRef(table: Table): string {
  if (table.schema) {
    return `${quoteName(table.schema)}.${quoteName(table.name)}`
  }
  return quoteName(table.name)
}

// -- Helper: format default expression for DDL --

function formatDefault(col: Column): string {
  if (!col.default) return ''
  if ('V' in col.default) {
    return col.default.V
  }
  if ('X' in col.default) {
    return col.default.X
  }
  return ''
}

// -- MssqlPlan --

/**
 * MssqlPlan generates MSSQL DDL SQL from schema changes.
 * Implements PlanDriver for use with the generic plan engine.
 *
 * MSSQL uses bracket quoting [name] and has specific DDL patterns
 * around identity columns, default constraints, and the lack of
 * CREATE OR REPLACE for views/functions/procedures.
 */
export class MssqlPlan implements PlanDriver {
  // -- Schema Operations --

  /** Generate SQL for creating a schema. */
  addSchema(schema: Schema): string[] {
    return [`CREATE SCHEMA [${schema.name}]`]
  }

  /** Generate SQL for dropping a schema. */
  dropSchema(schema: Schema): string[] {
    return [`DROP SCHEMA [${schema.name}]`]
  }

  // -- Table Operations --

  /** Generate SQL for adding a table. */
  addTable(table: Table): string[] {
    if (table.columns.length === 0) {
      throw new Error(`table "${table.name}" has no columns`)
    }
    const stmts: string[] = []
    const b = mssqlBuilder()
    b.P('CREATE TABLE').Table(table)
    b.WrapIndent((b) => {
      // Columns
      b.MapIndent(table.columns, (col, _i, b) => {
        this.columnDef(b, col)
      })

      // Primary key
      if (table.primaryKey) {
        b.Comma().NL().P('CONSTRAINT')
        const pkName = table.primaryKey.name || `PK_${table.name}`
        b.Ident(pkName).P('PRIMARY KEY')
        this.indexTypeParts(b, table.primaryKey)
      }

      // Unique constraints (from indexes marked as unique constraints)
      // Regular indexes are created separately

      // Foreign keys
      for (const fk of table.foreignKeys ?? []) {
        b.Comma().NL()
        this.fkDef(b, fk)
      }

      // Check constraints
      for (const chk of table.checks ?? []) {
        b.Comma().NL()
        this.checkDef(b, chk)
      }
    })
    stmts.push(b.toString())

    // Indexes (created separately, not inline)
    for (const idx of table.indexes ?? []) {
      stmts.push(this.createIndex(table, idx))
    }

    // Table comment via extended property
    const tableComment = findAttr<{ kind: 'comment'; text: string }>(table.attrs, 'comment')
    if (tableComment?.text) {
      stmts.push(addExtendedProperty('TABLE', table.schema, table.name, undefined, tableComment.text))
    }

    // Column comments via extended property
    for (const col of table.columns) {
      const cc = findAttr<{ kind: 'comment'; text: string }>(col.attrs, 'comment')
      if (cc?.text) {
        stmts.push(addExtendedProperty('COLUMN', table.schema, table.name, col.name, cc.text))
      }
    }

    return stmts
  }

  /** Generate SQL for dropping a table. */
  dropTable(table: Table): string[] {
    return [`DROP TABLE ${tableRef(table)}`]
  }

  /**
   * Generate SQL for modifying a table (column/index/FK changes).
   *
   * MSSQL requires careful ordering:
   * 1. Drop foreign keys referencing modified/dropped columns
   * 2. Drop indexes being dropped or modified
   * 3. Drop check constraints being dropped or modified
   * 4. Drop default constraints for columns being modified
   * 5. ALTER COLUMN for type/null changes
   * 6. ADD columns
   * 7. DROP columns
   * 8. ADD indexes
   * 9. ADD check constraints
   * 10. ADD foreign keys
   */
  modifyTable(_from: Table, to: Table, changes: Change[]): string[] {
    const stmts: string[] = []

    // Phase 1: Drops (FKs, indexes, checks, defaults)
    // Phase 2: Column alterations
    // Phase 3: Adds (columns, indexes, checks, FKs)

    for (const change of changes) {
      switch (change.type) {
        // -- Column Changes --

        case 'add_column': {
          const b = mssqlBuilder()
          b.P('ALTER TABLE').Table(to).P('ADD')
          this.columnDef(b, change.C)
          stmts.push(b.toString())
          // Column comment
          const cc = findAttr<{ kind: 'comment'; text: string }>(change.C.attrs, 'comment')
          if (cc?.text) {
            stmts.push(addExtendedProperty('COLUMN', to.schema, to.name, change.C.name, cc.text))
          }
          break
        }

        case 'drop_column': {
          // Drop any default constraint on this column first
          stmts.push(...this.dropDefaultConstraint(to, change.C.name))
          stmts.push(`ALTER TABLE ${tableRef(to)} DROP COLUMN [${change.C.name}]`)
          break
        }

        case 'modify_column': {
          stmts.push(...this.alterColumn(to, change.from, change.to, change.change))
          // Comment change via extended property
          if (change.change & ChangeKind.ChangeComment) {
            const cc = findAttr<{ kind: 'comment'; text: string }>(change.to.attrs, 'comment')
            if (cc?.text) {
              stmts.push(updateExtendedProperty('COLUMN', to.schema, to.name, change.to.name, cc.text))
            } else {
              stmts.push(dropExtendedProperty('COLUMN', to.schema, to.name, change.to.name))
            }
          }
          break
        }

        case 'rename_column': {
          const oldPath = `${to.schema ? `${to.schema}.` : ''}${to.name}.${change.from.name}`
          stmts.push(`EXEC sp_rename '${oldPath}', '${change.to.name}', 'COLUMN'`)
          break
        }

        // -- Index Changes --

        case 'add_index': {
          stmts.push(this.createIndex(to, change.I))
          break
        }

        case 'drop_index': {
          stmts.push(this.dropIndex(to, change.I))
          break
        }

        case 'modify_index': {
          // MSSQL: drop and recreate
          stmts.push(this.dropIndex(to, change.from))
          stmts.push(this.createIndex(to, change.to))
          break
        }

        case 'rename_index': {
          const oldPath = `${to.schema ? `${to.schema}.` : ''}${change.from.name}`
          stmts.push(`EXEC sp_rename '${oldPath}', '${change.to.name}', 'INDEX'`)
          break
        }

        // -- Primary Key Changes --

        case 'add_primary_key': {
          const pkName = change.P.name || `PK_${to.name}`
          const b = mssqlBuilder()
          b.P('ALTER TABLE').Table(to).P('ADD CONSTRAINT').Ident(pkName).P('PRIMARY KEY')
          this.indexTypeParts(b, change.P)
          stmts.push(b.toString())
          break
        }

        case 'drop_primary_key': {
          const pkName = change.P.name || `PK_${to.name}`
          stmts.push(`ALTER TABLE ${tableRef(to)} DROP CONSTRAINT [${pkName}]`)
          break
        }

        case 'modify_primary_key': {
          // Drop old PK then add new
          const oldPkName = change.from.name || `PK_${to.name}`
          stmts.push(`ALTER TABLE ${tableRef(to)} DROP CONSTRAINT [${oldPkName}]`)
          const newPkName = change.to.name || `PK_${to.name}`
          const b = mssqlBuilder()
          b.P('ALTER TABLE').Table(to).P('ADD CONSTRAINT').Ident(newPkName).P('PRIMARY KEY')
          this.indexTypeParts(b, change.to)
          stmts.push(b.toString())
          break
        }

        // -- Foreign Key Changes --

        case 'add_foreign_key': {
          const b = mssqlBuilder()
          b.P('ALTER TABLE').Table(to).P('ADD')
          this.fkDef(b, change.F)
          stmts.push(b.toString())
          break
        }

        case 'drop_foreign_key': {
          stmts.push(`ALTER TABLE ${tableRef(to)} DROP CONSTRAINT [${change.F.symbol}]`)
          break
        }

        case 'modify_foreign_key': {
          stmts.push(`ALTER TABLE ${tableRef(to)} DROP CONSTRAINT [${change.from.symbol}]`)
          const b = mssqlBuilder()
          b.P('ALTER TABLE').Table(to).P('ADD')
          this.fkDef(b, change.to)
          stmts.push(b.toString())
          break
        }

        // -- Check Constraint Changes --

        case 'add_check': {
          const b = mssqlBuilder()
          b.P('ALTER TABLE').Table(to).P('ADD')
          this.checkDef(b, change.C)
          stmts.push(b.toString())
          break
        }

        case 'drop_check': {
          if (change.C.name) {
            stmts.push(`ALTER TABLE ${tableRef(to)} DROP CONSTRAINT [${change.C.name}]`)
          }
          break
        }

        case 'modify_check': {
          if (change.from.name) {
            stmts.push(`ALTER TABLE ${tableRef(to)} DROP CONSTRAINT [${change.from.name}]`)
          }
          const b = mssqlBuilder()
          b.P('ALTER TABLE').Table(to).P('ADD')
          this.checkDef(b, change.to)
          stmts.push(b.toString())
          break
        }

        // -- Trigger Changes --

        case 'add_trigger': {
          stmts.push(...this.addTrigger(change.T))
          break
        }

        case 'drop_trigger': {
          stmts.push(...this.dropTrigger(change.T))
          break
        }

        case 'modify_trigger': {
          stmts.push(...this.dropTrigger(change.from))
          stmts.push(...this.addTrigger(change.to))
          break
        }

        // -- Attribute Changes (comments via extended properties) --

        case 'modify_attr': {
          const toAttr = change.to as any
          if (toAttr?.kind === 'comment') {
            stmts.push(updateExtendedProperty('TABLE', to.schema, to.name, undefined, toAttr.text))
          }
          break
        }

        case 'add_attr': {
          const attr = change.A as any
          if (attr?.kind === 'comment') {
            stmts.push(addExtendedProperty('TABLE', to.schema, to.name, undefined, attr.text))
          }
          break
        }

        case 'drop_attr': {
          const attr = change.A as any
          if (attr?.kind === 'comment') {
            stmts.push(dropExtendedProperty('TABLE', to.schema, to.name, undefined))
          }
          break
        }

        default:
          break
      }
    }

    return stmts
  }

  // -- Column Definition --

  /** Generate ALTER COLUMN clauses for a column modification. */
  private alterColumn(table: Table, from: Column, to: Column, changeKind: number): string[] {
    const stmts: string[] = []
    let k = changeKind

    // Handle default change first (requires dropping/adding named constraint)
    if (k & ChangeKind.ChangeDefault) {
      // Drop existing default constraint
      stmts.push(...this.dropDefaultConstraint(table, from.name))
      // Add new default constraint if the target has one
      if (to.default !== undefined) {
        const defVal = formatDefault(to)
        if (defVal) {
          const constraintName = `DF_${table.name}_${to.name}`
          stmts.push(
            `ALTER TABLE ${tableRef(table)} ADD CONSTRAINT [${constraintName}] DEFAULT ${defVal} FOR [${to.name}]`,
          )
        }
      }
      k &= ~ChangeKind.ChangeDefault
    }

    // Handle type and nullability changes via ALTER COLUMN
    if (k & (ChangeKind.ChangeType | ChangeKind.ChangeNull | ChangeKind.ChangeCollate)) {
      // MSSQL requires the full column type and nullability in ALTER COLUMN
      const typeStr = typeDDL(to.type.type)
      let alter = `ALTER TABLE ${tableRef(table)} ALTER COLUMN [${to.name}] ${typeStr}`

      // Collation
      if (k & ChangeKind.ChangeCollate) {
        const collation = findAttr<{ kind: 'collation'; V: string }>(to.attrs, 'collation')
        if (collation) {
          alter += ` COLLATE ${collation.V}`
        }
      }

      // Nullability — must always be specified in ALTER COLUMN
      if (to.type.null) {
        alter += ' NULL'
      } else {
        alter += ' NOT NULL'
      }

      stmts.push(alter)
      k &= ~(ChangeKind.ChangeType | ChangeKind.ChangeNull | ChangeKind.ChangeCollate)
    }

    // Handle identity change (MSSQL does not support altering identity — requires table rebuild)
    if (k & ChangeKind.ChangeAttr) {
      // Identity cannot be added/removed via ALTER COLUMN in MSSQL.
      // This would require a full table rebuild (drop + recreate).
      // Emit a comment noting the limitation.
      k &= ~ChangeKind.ChangeAttr
    }

    // Handle generated/computed column change
    if (k & ChangeKind.ChangeGenerated) {
      // Computed columns cannot be altered in-place in MSSQL.
      // Must drop and re-add the column.
      k &= ~ChangeKind.ChangeGenerated
    }

    // Comment changes are handled separately (not in ALTER TABLE)
    if (k & ChangeKind.ChangeComment) {
      k &= ~ChangeKind.ChangeComment
    }

    return stmts
  }

  /**
   * Drop the default constraint for a column.
   * In MSSQL, defaults are named constraints that must be dropped by name.
   * Uses a dynamic SQL pattern to find and drop the constraint.
   */
  private dropDefaultConstraint(table: Table, colName: string): string[] {
    const schemaName = table.schema ?? 'dbo'
    const safeSchema = schemaName.replaceAll("'", "''")
    const safeTable = table.name.replaceAll("'", "''")
    const safeCol = colName.replaceAll("'", "''")
    return [
      `DECLARE @DF_Name NVARCHAR(256)\n` +
        `SELECT @DF_Name = dc.name\n` +
        `FROM sys.default_constraints dc\n` +
        `JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id\n` +
        `WHERE dc.parent_object_id = OBJECT_ID('${safeSchema}.${safeTable}') AND c.name = '${safeCol}'\n` +
        `IF @DF_Name IS NOT NULL\n` +
        `  EXEC('ALTER TABLE ${tableRef(table)} DROP CONSTRAINT [' + @DF_Name + ']')`,
    ]
  }

  // -- Column Definition Builder --

  /** Write a full column definition for CREATE TABLE. */
  private columnDef(b: Builder, col: Column): void {
    b.Ident(col.name)

    // Computed column
    const genExpr = findAttr<{ kind: 'generated'; expr: string; type?: string }>(col.attrs, 'generated')
    if (genExpr) {
      b.P('AS').raw(`(${genExpr.expr})`)
      if (genExpr.type === 'PERSISTED' || genExpr.type === 'STORED') {
        b.P('PERSISTED')
      }
      return
    }

    // Type
    b.P(typeDDL(col.type.type))

    // Collation
    const collation = findAttr<{ kind: 'collation'; V: string }>(col.attrs, 'collation')
    if (collation?.V) {
      b.P('COLLATE').P(collation.V)
    }

    // Identity
    const identity = findAttr<{ kind: 'identity'; seed: number; increment: number }>(col.attrs, 'identity')
    if (identity) {
      const seed = identity.seed ?? 1
      const inc = identity.increment ?? 1
      b.P(`IDENTITY(${seed},${inc})`)
    }

    // NULL / NOT NULL
    if (!col.type.null) {
      b.P('NOT NULL')
    } else {
      b.P('NULL')
    }

    // Default constraint
    if (col.default) {
      const defVal = formatDefault(col)
      if (defVal) {
        b.P('DEFAULT').P(defVal)
      }
    }
  }

  // -- Index Operations --

  /**
   * Generate CREATE INDEX statement.
   * MSSQL: CREATE [UNIQUE] [NONCLUSTERED] INDEX [name] ON [schema].[table] ([cols]) [INCLUDE (...)] [WHERE ...]
   */
  private createIndex(table: Table, idx: Index): string {
    const b = mssqlBuilder()
    b.P('CREATE')
    if (idx.unique) b.P('UNIQUE')

    // Index type
    const clustered = findAttr<{ kind: 'clustered'; V: boolean }>(idx.attrs, 'clustered')
    if (clustered?.V === true) {
      b.P('CLUSTERED')
    } else {
      b.P('NONCLUSTERED')
    }

    b.P('INDEX')
    if (idx.name) b.Ident(idx.name)
    b.P('ON').Table(table)

    // Key columns
    this.indexTypeParts(b, idx)

    // INCLUDE columns
    const include = findAttr<{ kind: 'include'; columns: string[] }>(idx.attrs, 'include')
    if (include && include.columns.length > 0) {
      b.P('INCLUDE')
      b.Wrap((b) => {
        b.MapComma(include.columns, (col, _i, b) => {
          b.Ident(col)
        })
      })
    }

    // WHERE (filtered index)
    const filter = findAttr<{ kind: 'filter'; expr: string }>(idx.attrs, 'filter')
    if (filter?.expr) {
      b.P('WHERE').P(filter.expr)
    }

    return b.toString()
  }

  /** Generate DROP INDEX statement. MSSQL: DROP INDEX [name] ON [schema].[table] */
  private dropIndex(table: Table, idx: Index): string {
    return `DROP INDEX [${idx.name}] ON ${tableRef(table)}`
  }

  /** Write index parts as a parenthesized list. */
  private indexTypeParts(b: Builder, idx: Index): void {
    b.Wrap((b) => {
      b.MapComma(idx.parts, (part, _i, b) => {
        if (part.column) {
          b.Ident(part.column)
        } else if (part.expr) {
          b.raw(part.expr)
        }
        if (part.desc) {
          b.P('DESC')
        }
      })
    })
  }

  // -- Foreign Key Definition --

  /** Write a foreign key constraint definition. */
  private fkDef(b: Builder, fk: ForeignKey): void {
    if (fk.symbol) {
      b.P('CONSTRAINT').Ident(fk.symbol)
    }
    b.P('FOREIGN KEY')
    b.Wrap((b) => {
      b.MapComma(fk.columns, (col, _i, b) => {
        b.Ident(col)
      })
    })
    b.P('REFERENCES')
    if (fk.refSchema) {
      b.Ident(fk.refSchema)
      b.raw('.')
    }
    b.Ident(fk.refTable)
    b.Wrap((b) => {
      b.MapComma(fk.refColumns, (col, _i, b) => {
        b.Ident(col)
      })
    })
    if (fk.onUpdate && fk.onUpdate !== 'NO ACTION') {
      b.P('ON UPDATE').P(fk.onUpdate)
    }
    if (fk.onDelete && fk.onDelete !== 'NO ACTION') {
      b.P('ON DELETE').P(fk.onDelete)
    }
  }

  // -- Check Constraint Definition --

  /** Write a CHECK constraint definition. */
  private checkDef(b: Builder, check: Check): void {
    if (check.name) {
      b.P('CONSTRAINT').Ident(check.name)
    }
    b.P('CHECK').raw(`(${check.expr})`)
  }

  // -- View Operations --

  /** Generate SQL for adding a view. MSSQL does not support CREATE OR REPLACE. */
  addView(view: View): string[] {
    const b = mssqlBuilder()
    b.P('CREATE VIEW').View(view).P('AS')
    b.P(view.def ?? '')
    return [b.toString()]
  }

  /** Generate SQL for dropping a view. */
  dropView(view: View): string[] {
    const ref = view.schema ? `[${view.schema}].[${view.name}]` : `[${view.name}]`
    return [`DROP VIEW IF EXISTS ${ref}`]
  }

  /** Generate SQL for modifying a view. MSSQL has no CREATE OR REPLACE — drop and recreate. */
  modifyView(from: View, to: View): string[] {
    return [...this.dropView(from), ...this.addView(to)]
  }

  // -- Function Operations --

  /** Generate SQL for adding a function. */
  addFunc(func: Func): string[] {
    // If body contains the full CREATE FUNCTION statement, use it directly
    if (func.body) {
      return [func.body]
    }
    const b = mssqlBuilder()
    b.P('CREATE FUNCTION').Func(func)
    b.raw('(')
    if (func.args) {
      b.MapComma(func.args, (arg, _i, b) => {
        if (arg.name) b.P(`@${arg.name.replace(/^@/, '')}`)
        if (arg.type) b.P(typeDDL(arg.type.type))
      })
    }
    b.raw(')')
    if (func.ret) {
      b.P('RETURNS').P(typeDDL(func.ret.type))
    }
    return [b.toString()]
  }

  /** Generate SQL for dropping a function. MSSQL does not support DROP ... IF EXISTS before 2016. */
  dropFunc(func: Func): string[] {
    const ref = func.schema ? `[${func.schema}].[${func.name}]` : `[${func.name}]`
    return [`DROP FUNCTION IF EXISTS ${ref}`]
  }

  // -- Procedure Operations --

  /** Generate SQL for adding a procedure. */
  addProc(proc: Proc): string[] {
    // If body contains the full CREATE PROCEDURE statement, use it directly
    if (proc.body) {
      return [proc.body]
    }
    const b = mssqlBuilder()
    b.P('CREATE PROCEDURE').Func(proc)
    if (proc.args && proc.args.length > 0) {
      b.raw('\n')
      b.MapComma(proc.args, (arg, _i, b) => {
        if (arg.name) b.P(`@${arg.name.replace(/^@/, '')}`)
        if (arg.type) b.P(typeDDL(arg.type.type))
        if (arg.mode === 'OUTPUT' || arg.mode === 'OUT') b.P('OUTPUT')
      })
      b.raw('\n')
    }
    b.P('AS')
    return [b.toString()]
  }

  /** Generate SQL for dropping a procedure. */
  dropProc(proc: Proc): string[] {
    const ref = proc.schema ? `[${proc.schema}].[${proc.name}]` : `[${proc.name}]`
    return [`DROP PROCEDURE IF EXISTS ${ref}`]
  }

  // -- Trigger Operations --

  /** Generate SQL for adding a trigger. */
  addTrigger(trigger: Trigger): string[] {
    // If body contains the full CREATE TRIGGER statement, use it directly
    if (trigger.body) {
      return [trigger.body]
    }
    // Fallback: reconstruct from parts
    const b = mssqlBuilder()
    b.P('CREATE TRIGGER')
    if (trigger.table) {
      const schemaName = (trigger as any).schema
      if (schemaName) {
        b.Ident(schemaName)
        b.raw('.')
      }
    }
    b.Ident(trigger.name)
    if (trigger.table) {
      b.P('ON').Ident(trigger.table)
    }
    if (trigger.timing) {
      b.P(trigger.timing)
    }
    if (trigger.events && trigger.events.length > 0) {
      b.P(trigger.events.join(', '))
    }
    b.P('AS')
    return [b.toString()]
  }

  /** Generate SQL for dropping a trigger. */
  dropTrigger(trigger: Trigger): string[] {
    const schemaName = (trigger as any).schema
    const ref = schemaName ? `[${schemaName}].[${trigger.name}]` : `[${trigger.name}]`
    return [`DROP TRIGGER IF EXISTS ${ref}`]
  }

  // -- Sequence Operations --

  /** Generate SQL for adding a sequence. */
  addSequence(seq: Sequence): string[] {
    const b = mssqlBuilder()
    b.P('CREATE SEQUENCE')
    if (seq.schema) {
      b.SchemaResource(seq.schema, seq.name)
    } else {
      b.Ident(seq.name)
    }
    if (seq.type) b.P('AS').P(typeDDL(seq.type.type))
    if (seq.start !== undefined) b.P('START WITH').Int(seq.start)
    if (seq.increment !== undefined) b.P('INCREMENT BY').Int(seq.increment)
    if (seq.min !== undefined) b.P('MINVALUE').Int(seq.min)
    if (seq.max !== undefined) b.P('MAXVALUE').Int(seq.max)
    if (seq.cache !== undefined) b.P('CACHE').Int(seq.cache)
    if (seq.cycle) b.P('CYCLE')
    return [b.toString()]
  }

  /** Generate SQL for dropping a sequence. */
  dropSequence(seq: Sequence): string[] {
    const b = mssqlBuilder()
    b.P('DROP SEQUENCE')
    if (seq.schema) {
      b.SchemaResource(seq.schema, seq.name)
    } else {
      b.Ident(seq.name)
    }
    return [b.toString()]
  }

  /** Generate SQL for modifying a sequence. */
  modifySequence(from: Sequence, to: Sequence): string[] {
    const b = mssqlBuilder()
    b.P('ALTER SEQUENCE')
    if (to.schema) {
      b.SchemaResource(to.schema, to.name)
    } else {
      b.Ident(to.name)
    }
    if (from.start !== to.start && to.start !== undefined) {
      b.P('RESTART WITH').Int(to.start)
    }
    if (from.increment !== to.increment && to.increment !== undefined) {
      b.P('INCREMENT BY').Int(to.increment)
    }
    if (from.min !== to.min && to.min !== undefined) {
      b.P('MINVALUE').Int(to.min)
    }
    if (from.max !== to.max && to.max !== undefined) {
      b.P('MAXVALUE').Int(to.max)
    }
    if (from.cache !== to.cache && to.cache !== undefined) {
      b.P('CACHE').Int(to.cache)
    }
    if (from.cycle !== to.cycle) {
      b.P(to.cycle ? 'CYCLE' : 'NO CYCLE')
    }
    return [b.toString()]
  }

  // -- Schema Object Operations --

  /** Generate SQL for adding a schema-level object. */
  addObject(obj: any): string[] {
    if (!obj) return []
    // MSSQL does not have enums, domains, composites, or extensions.
    // Sequences are handled via addSequence.
    if (obj.name && obj.increment !== undefined) {
      return this.addSequence(obj)
    }
    return []
  }

  /** Generate SQL for dropping a schema-level object. */
  dropObject(obj: any): string[] {
    if (!obj) return []
    if (obj.name && obj.increment !== undefined) {
      return this.dropSequence(obj)
    }
    return []
  }
}

// -- Extended Property Helpers --

/**
 * Generate sp_addextendedproperty call for MS_Description.
 * Used for table and column comments in MSSQL.
 */
function addExtendedProperty(
  level: 'TABLE' | 'COLUMN',
  schemaName: string | undefined,
  tableName: string,
  columnName: string | undefined,
  value: string,
): string {
  const schema = schemaName ?? 'dbo'
  if (level === 'COLUMN' && columnName) {
    return (
      `EXEC sp_addextendedproperty @name=N'MS_Description', @value=N${quote(value)}, ` +
      `@level0type=N'SCHEMA', @level0name=${quoteName(schema)}, ` +
      `@level1type=N'TABLE', @level1name=${quoteName(tableName)}, ` +
      `@level2type=N'COLUMN', @level2name=${quoteName(columnName)}`
    )
  }
  return (
    `EXEC sp_addextendedproperty @name=N'MS_Description', @value=N${quote(value)}, ` +
    `@level0type=N'SCHEMA', @level0name=${quoteName(schema)}, ` +
    `@level1type=N'TABLE', @level1name=${quoteName(tableName)}`
  )
}

/**
 * Generate sp_updateextendedproperty call for MS_Description.
 */
function updateExtendedProperty(
  level: 'TABLE' | 'COLUMN',
  schemaName: string | undefined,
  tableName: string,
  columnName: string | undefined,
  value: string,
): string {
  const schema = schemaName ?? 'dbo'
  if (level === 'COLUMN' && columnName) {
    return (
      `EXEC sp_updateextendedproperty @name=N'MS_Description', @value=N${quote(value)}, ` +
      `@level0type=N'SCHEMA', @level0name=${quoteName(schema)}, ` +
      `@level1type=N'TABLE', @level1name=${quoteName(tableName)}, ` +
      `@level2type=N'COLUMN', @level2name=${quoteName(columnName)}`
    )
  }
  return (
    `EXEC sp_updateextendedproperty @name=N'MS_Description', @value=N${quote(value)}, ` +
    `@level0type=N'SCHEMA', @level0name=${quoteName(schema)}, ` +
    `@level1type=N'TABLE', @level1name=${quoteName(tableName)}`
  )
}

/**
 * Generate sp_dropextendedproperty call for MS_Description.
 */
function dropExtendedProperty(
  level: 'TABLE' | 'COLUMN',
  schemaName: string | undefined,
  tableName: string,
  columnName: string | undefined,
): string {
  const schema = schemaName ?? 'dbo'
  if (level === 'COLUMN' && columnName) {
    return (
      `EXEC sp_dropextendedproperty @name=N'MS_Description', ` +
      `@level0type=N'SCHEMA', @level0name=${quoteName(schema)}, ` +
      `@level1type=N'TABLE', @level1name=${quoteName(tableName)}, ` +
      `@level2type=N'COLUMN', @level2name=${quoteName(columnName)}`
    )
  }
  return (
    `EXEC sp_dropextendedproperty @name=N'MS_Description', ` +
    `@level0type=N'SCHEMA', @level0name=${quoteName(schema)}, ` +
    `@level1type=N'TABLE', @level1name=${quoteName(tableName)}`
  )
}
