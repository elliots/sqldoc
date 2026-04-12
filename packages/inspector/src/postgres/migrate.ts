// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/postgres/migrate_oss.go

import type { PlanDriver } from '../internal/plan.ts'
import { Builder, mayWrap } from '../internal/sqlx.ts'
import type { Change } from '../schema/migrate.ts'
import { ChangeKind } from '../schema/migrate.ts'
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
} from '../schema/schema.ts'
import { quote, typeDDL } from './convert.ts'
import { IndexTypeBTree } from './driver.ts'

// -- Helper: find attribute by kind --

function findAttr<T extends Attr>(attrs: Attr[] | undefined, kind: string): T | undefined {
  if (!attrs) return undefined
  return attrs.find((a) => 'kind' in a && (a as any).kind === kind) as T | undefined
}

function _hasAttr(attrs: Attr[] | undefined, kind: string): boolean {
  return findAttr(attrs, kind) !== undefined
}

// -- PostgreSQL Builder Factory --

function pgBuilder(stripSchema?: string): Builder {
  return new Builder({ quoteOpening: '"', quoteClosing: '"', schema: stripSchema, indent: '  ' })
}

// -- PostgresPlan --

/**
 * PostgresPlan generates PostgreSQL DDL SQL from schema changes.
 * Implements PlanDriver for use with the generic plan engine.
 */
export class PostgresPlan implements PlanDriver {
  /** Generate SQL for creating a schema. */
  addSchema(schema: Schema): string[] {
    const stmts: string[] = []
    const b = pgBuilder()
    b.P('CREATE SCHEMA')
    // public schema gets IF NOT EXISTS since it's auto-created
    if (schema.name === 'public') {
      b.P('IF NOT EXISTS')
    }
    b.Ident(schema.name)
    stmts.push(b.toString())

    // Schema comment
    const comment = findAttr<{ kind: 'comment'; text: string }>(schema.attrs, 'comment')
    if (comment?.text) {
      stmts.push(`COMMENT ON SCHEMA "${schema.name}" IS ${quote(comment.text)}`)
    }

    return stmts
  }

  /** Generate SQL for dropping a schema. */
  dropSchema(schema: Schema): string[] {
    return [`DROP SCHEMA "${schema.name}" CASCADE`]
  }

  /** Generate SQL for adding a schema-level object (enum, domain, composite, extension, sequence). */
  addObject(obj: any): string[] {
    if (!obj) return []
    switch (obj.kind) {
      case 'enum':
        return this.addEnum(obj.T, obj.values ?? [], obj.schema)
      case 'composite':
        return this.addCompositeType(obj)
      case 'domain':
        return this.addDomainType(obj)
      case 'range_type': {
        const ident = obj.schema ? `"${obj.schema}"."${obj.T}"` : `"${obj.T}"`
        const subtype = obj.subtype ? formatTypeRef(obj.subtype) : 'integer'
        return [`CREATE TYPE ${ident} AS RANGE (SUBTYPE = ${subtype})`]
      }
      case 'aggregate': {
        const argList = (obj.args ?? []).join(', ')
        const ident = obj.schema ? `"${obj.schema}"."${obj.name}"` : `"${obj.name}"`
        // Schema-qualify function references
        const sfunc = obj.stateFunc?.includes('.')
          ? `"${obj.stateFunc.split('.')[0]}"."${obj.stateFunc.split('.')[1]}"`
          : obj.schema
            ? `"${obj.schema}"."${obj.stateFunc}"`
            : `"${obj.stateFunc}"`
        let sql = `CREATE AGGREGATE ${ident}(${argList}) (SFUNC = ${sfunc}, STYPE = ${obj.stateType}`
        if (obj.finalFunc) {
          const ffunc = obj.finalFunc.includes('.')
            ? `"${obj.finalFunc.split('.')[0]}"."${obj.finalFunc.split('.')[1]}"`
            : obj.schema
              ? `"${obj.schema}"."${obj.finalFunc}"`
              : `"${obj.finalFunc}"`
          sql += `, FINALFUNC = ${ffunc}`
        }
        if (obj.initVal != null && obj.initVal !== '') sql += `, INITCOND = '${obj.initVal}'`
        if (obj.sortOp) sql += `, SORTOP = ${obj.sortOp}`
        if (obj.parallel && obj.parallel !== 'UNSAFE') sql += `, PARALLEL = ${obj.parallel}`
        sql += ')'
        return [sql]
      }
      default:
        // Extension, sequence, and other objects
        if (obj.name && obj.version !== undefined) {
          // Extension
          return [`CREATE EXTENSION IF NOT EXISTS "${obj.name}"`]
        }
        if (obj.name && obj.increment !== undefined) {
          // Sequence
          return this.addSequence(obj)
        }
        return []
    }
  }

  /** Generate SQL for dropping a schema-level object. */
  dropObject(obj: any): string[] {
    if (!obj) return []
    switch (obj.kind) {
      case 'enum':
        return this.dropEnum(obj.T, obj.schema)
      case 'composite': {
        const ident = obj.schema ? `"${obj.schema}"."${obj.T}"` : `"${obj.T}"`
        return [`DROP TYPE ${ident}`]
      }
      case 'domain': {
        const ident = obj.schema ? `"${obj.schema}"."${obj.T}"` : `"${obj.T}"`
        return [`DROP DOMAIN ${ident}`]
      }
      case 'range_type': {
        const ident = obj.schema ? `"${obj.schema}"."${obj.T}"` : `"${obj.T}"`
        return [`DROP TYPE ${ident}`]
      }
      case 'aggregate': {
        const ident = obj.schema ? `"${obj.schema}"."${obj.name}"` : `"${obj.name}"`
        const argList = (obj.args ?? []).join(', ')
        return [`DROP AGGREGATE ${ident}(${argList})`]
      }
      default:
        if (obj.name && obj.version !== undefined) {
          return [`DROP EXTENSION IF EXISTS "${obj.name}"`]
        }
        return []
    }
  }

  /** Generate SQL for creating a composite type. */
  private addCompositeType(obj: any): string[] {
    const ident = obj.schema ? `"${obj.schema}"."${obj.T}"` : `"${obj.T}"`
    const fields = (obj.fields ?? obj.compositeFields ?? [])
      .map((f: any) => `"${f.name}" ${formatTypeRef(f.type?.T || 'text')}`)
      .join(', ')
    return [`CREATE TYPE ${ident} AS (${fields})`]
  }

  /** Generate SQL for creating a domain type. */
  private addDomainType(obj: any): string[] {
    const ident = obj.schema ? `"${obj.schema}"."${obj.T}"` : `"${obj.T}"`
    const baseType = obj.type ? typeDDL(obj.type) : 'text'
    const stmts = [`CREATE DOMAIN ${ident} AS ${baseType}`]
    if (!obj.null) {
      stmts[0] += ' NOT NULL'
    }
    if (obj.default) {
      const dflt = obj.default.V ?? obj.default.X ?? ''
      if (dflt) stmts[0] += ` DEFAULT ${dflt}`
    }
    for (const c of obj.checks ?? []) {
      stmts.push(`ALTER DOMAIN ${ident} ADD CONSTRAINT "${c.name}" ${c.expr}`)
    }
    return stmts
  }

  /** Generate SQL for adding a table. */
  addTable(table: Table): string[] {
    if (table.columns.length === 0) {
      throw new Error(`table "${table.name}" has no columns`)
    }
    const stmts: string[] = []
    const b = pgBuilder()
    b.P('CREATE TABLE').Table(table)
    b.WrapIndent((b) => {
      // Columns
      b.MapIndent(table.columns, (col, _i, b) => {
        columnDef(b, col)
      })

      // Primary key
      if (table.primaryKey) {
        b.Comma().NL().P('PRIMARY KEY')
        indexParts(b, table.primaryKey)
      }

      // Foreign keys
      for (const fk of table.foreignKeys ?? []) {
        b.Comma().NL()
        fkDef(b, fk)
      }

      // Check constraints
      for (const chk of table.checks ?? []) {
        b.Comma().NL()
        checkDef(b, chk)
      }
    })
    stmts.push(b.toString())

    // Indexes (created separately, not inline)
    for (const idx of table.indexes ?? []) {
      stmts.push(...this.createIndex(table, idx))
    }

    // Table comment
    const tableComment = findAttr<{ kind: 'comment'; text: string }>(table.attrs, 'comment')
    if (tableComment?.text) {
      stmts.push(commentOnTable(table, tableComment.text))
    }

    // Column comments
    for (const col of table.columns) {
      const cc = findAttr<{ kind: 'comment'; text: string }>(col.attrs, 'comment')
      if (cc?.text) {
        stmts.push(commentOnColumn(table, col, cc.text))
      }
    }

    // Index comments
    for (const idx of table.indexes ?? []) {
      const ic = findAttr<{ kind: 'comment'; text: string }>(idx.attrs, 'comment')
      if (ic?.text) {
        stmts.push(commentOnIndex(table, idx, ic.text))
      }
    }

    // RLS policies
    if ((table.policies?.length ?? 0) > 0) {
      stmts.push(enableRLS(table))
      for (const policy of table.policies ?? []) {
        stmts.push(...this.createPolicy(table, policy))
      }
    }

    // Triggers are emitted as separate add_trigger changes, not in addTable
    return stmts
  }

  /** Generate SQL for dropping a table. */
  dropTable(table: Table): string[] {
    const b = pgBuilder()
    b.P('DROP TABLE').Table(table)
    return [b.toString()]
  }

  /** Generate SQL for modifying a table (column/index/FK changes). */
  modifyTable(_from: Table, to: Table, changes: Change[]): string[] {
    const stmts: string[] = []
    const alterParts: string[] = []

    for (const change of changes) {
      switch (change.type) {
        case 'add_column': {
          const b = pgBuilder()
          b.P('ADD COLUMN')
          columnDef(b, change.C)
          alterParts.push(b.toString())
          // Column comment
          const cc = findAttr<{ kind: 'comment'; text: string }>(change.C.attrs, 'comment')
          if (cc?.text) {
            stmts.push(commentOnColumn(to, change.C, cc.text))
          }
          break
        }

        case 'drop_column': {
          alterParts.push(`DROP COLUMN "${change.C.name}"`)
          break
        }

        case 'modify_column': {
          const parts = this.alterColumn(change.from, change.to, change.change)
          alterParts.push(...parts)
          // Comment change
          if (change.change & ChangeKind.ChangeComment) {
            const cc = findAttr<{ kind: 'comment'; text: string }>(change.to.attrs, 'comment')
            stmts.push(commentOnColumn(to, change.to, cc?.text ?? ''))
          }
          break
        }

        case 'add_index': {
          stmts.push(...this.createIndex(to, change.I))
          break
        }

        case 'drop_index': {
          stmts.push(...this.dropIndex(to, change.I))
          break
        }

        case 'modify_index': {
          // Rebuild: drop + create
          stmts.push(...this.dropIndex(to, change.from))
          stmts.push(...this.createIndex(to, change.to))
          break
        }

        case 'add_primary_key': {
          const b = pgBuilder()
          b.P('ADD PRIMARY KEY')
          indexParts(b, change.P)
          alterParts.push(b.toString())
          break
        }

        case 'drop_primary_key': {
          const pkName = change.P.name || `${to.name}_pkey`
          alterParts.push(`DROP CONSTRAINT "${pkName}"`)
          break
        }

        case 'modify_primary_key': {
          const pkName = change.from.name || `${to.name}_pkey`
          alterParts.push(`DROP CONSTRAINT "${pkName}"`)
          const b = pgBuilder()
          b.P('ADD PRIMARY KEY')
          indexParts(b, change.to)
          alterParts.push(b.toString())
          break
        }

        case 'add_foreign_key': {
          const b = pgBuilder()
          b.P('ADD')
          fkDef(b, change.F)
          alterParts.push(b.toString())
          break
        }

        case 'drop_foreign_key': {
          alterParts.push(`DROP CONSTRAINT "${change.F.symbol}"`)
          break
        }

        case 'modify_foreign_key': {
          alterParts.push(`DROP CONSTRAINT "${change.from.symbol}"`)
          const b = pgBuilder()
          b.P('ADD')
          fkDef(b, change.to)
          alterParts.push(b.toString())
          break
        }

        case 'add_check': {
          const b = pgBuilder()
          b.P('ADD')
          checkDef(b, change.C)
          alterParts.push(b.toString())
          break
        }

        case 'drop_check': {
          if (change.C.name) {
            alterParts.push(`DROP CONSTRAINT "${change.C.name}"`)
          }
          break
        }

        case 'modify_check': {
          if (change.from.name) {
            alterParts.push(`DROP CONSTRAINT "${change.from.name}"`)
          }
          const b = pgBuilder()
          b.P('ADD')
          checkDef(b, change.to)
          alterParts.push(b.toString())
          break
        }

        case 'add_policy': {
          stmts.push(enableRLS(to))
          stmts.push(...this.createPolicy(to, change.P))
          break
        }

        case 'drop_policy': {
          stmts.push(dropPolicy(to, change.P))
          break
        }

        case 'modify_policy': {
          stmts.push(dropPolicy(to, change.from))
          stmts.push(...this.createPolicy(to, change.to))
          break
        }

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

        case 'modify_attr': {
          const toAttr = change.to as any
          if (toAttr?.kind === 'comment') {
            stmts.push(commentOnTable(to, toAttr.text))
          }
          break
        }

        case 'add_attr': {
          const attr = change.A as any
          if (attr?.kind === 'comment') {
            stmts.push(commentOnTable(to, attr.text))
          }
          break
        }

        case 'rename_column': {
          stmts.push(`ALTER TABLE ${tableRef(to)} RENAME COLUMN "${change.from.name}" TO "${change.to.name}"`)
          break
        }

        case 'rename_index': {
          const prefix = to.schema ? `"${to.schema}".` : ''
          stmts.push(`ALTER INDEX ${prefix}"${change.from.name}" RENAME TO "${change.to.name}"`)
          break
        }

        default:
          // Other changes not handled at table level
          break
      }
    }

    // Emit ALTER TABLE with all accumulated parts
    if (alterParts.length > 0) {
      const ref = tableRef(to)
      const stmt = `ALTER TABLE ${ref} ${alterParts.join(', ')}`
      stmts.unshift(stmt)
    }

    return stmts
  }

  /** Generate ALTER COLUMN clauses for a column modification. */
  private alterColumn(_from: Column, to: Column, changeKind: ChangeKind): string[] {
    const parts: string[] = []
    let k = changeKind

    while (k !== ChangeKind.NoChange) {
      if (k & ChangeKind.ChangeType) {
        const typeStr = typeDDL(to.type.type)
        parts.push(`ALTER COLUMN "${to.name}" TYPE ${typeStr}`)
        k &= ~ChangeKind.ChangeType
      } else if (k & ChangeKind.ChangeNull && to.type.null) {
        parts.push(`ALTER COLUMN "${to.name}" DROP NOT NULL`)
        k &= ~ChangeKind.ChangeNull
      } else if (k & ChangeKind.ChangeNull && !to.type.null) {
        parts.push(`ALTER COLUMN "${to.name}" SET NOT NULL`)
        k &= ~ChangeKind.ChangeNull
      } else if (k & ChangeKind.ChangeDefault && to.default === undefined) {
        parts.push(`ALTER COLUMN "${to.name}" DROP DEFAULT`)
        k &= ~ChangeKind.ChangeDefault
      } else if (k & ChangeKind.ChangeDefault && to.default !== undefined) {
        const def = formatDefault(to)
        parts.push(`ALTER COLUMN "${to.name}" SET ${def}`)
        k &= ~ChangeKind.ChangeDefault
      } else if (k & ChangeKind.ChangeAttr) {
        // Identity changes — PostgreSQL requires separate ALTER COLUMN clauses
        const toId = findAttr<{
          kind: 'identity'
          generation: string
          sequence?: { start: number; increment: number }
        }>(to.attrs, 'identity')
        if (toId) {
          const gen = toId.generation || 'BY DEFAULT'
          parts.push(`ALTER COLUMN "${to.name}" SET GENERATED ${gen}`)
          const seq = toId.sequence
          if (seq) {
            if (seq.start !== undefined) {
              parts.push(`ALTER COLUMN "${to.name}" SET START WITH ${seq.start}`)
            }
            if (seq.increment !== undefined) {
              parts.push(`ALTER COLUMN "${to.name}" SET INCREMENT BY ${seq.increment}`)
            }
          }
        }
        k &= ~ChangeKind.ChangeAttr
      } else if (k & ChangeKind.ChangeGenerated) {
        parts.push(`ALTER COLUMN "${to.name}" DROP EXPRESSION`)
        k &= ~ChangeKind.ChangeGenerated
      } else if (k & ChangeKind.ChangeCollate) {
        // Collation changes require TYPE change with COLLATE
        const typeStr = typeDDL(to.type.type)
        const collation = findAttr<{ kind: 'collation'; V: string }>(to.attrs, 'collation')
        if (collation) {
          parts.push(`ALTER COLUMN "${to.name}" TYPE ${typeStr} COLLATE "${collation.V}"`)
        } else {
          // Reset to column type's default collation
          parts.push(`ALTER COLUMN "${to.name}" TYPE ${typeStr}`)
        }
        k &= ~ChangeKind.ChangeCollate
      } else if (k & ChangeKind.ChangeComment) {
        // Comments handled separately, not in ALTER TABLE
        k &= ~ChangeKind.ChangeComment
      } else {
        // Skip unknown change bits
        break
      }
    }

    return parts
  }

  /** Generate SQL for adding a view. */
  addView(view: View): string[] {
    const stmts: string[] = []
    const b = pgBuilder()
    if (view.materialized) {
      b.P('CREATE MATERIALIZED VIEW').View(view)
    } else {
      b.P('CREATE VIEW').View(view)
    }
    if (view.def) {
      b.P('AS').P(view.def)
    }
    stmts.push(b.toString())

    // View comment
    const comment = findAttr<{ kind: 'comment'; text: string }>(view.attrs, 'comment')
    if (comment?.text) {
      const prefix = view.schema ? `"${view.schema}".` : ''
      const objType = view.materialized ? 'MATERIALIZED VIEW' : 'VIEW'
      stmts.push(`COMMENT ON ${objType} ${prefix}"${view.name}" IS ${quote(comment.text)}`)
    }

    // Materialized view indexes
    if (view.materialized && view.indexes) {
      for (const idx of view.indexes) {
        const ib = pgBuilder()
        ib.P('CREATE')
        if (idx.unique) ib.P('UNIQUE')
        ib.P('INDEX')
        if (idx.name) ib.Ident(idx.name)
        ib.P('ON').View(view)
        indexParts(ib, idx)
        stmts.push(ib.toString())
      }
    }

    return stmts
  }

  /** Generate SQL for dropping a view. */
  dropView(view: View): string[] {
    const b = pgBuilder()
    if (view.materialized) {
      b.P('DROP MATERIALIZED VIEW').View(view)
    } else {
      b.P('DROP VIEW').View(view)
    }
    return [b.toString()]
  }

  /** Generate SQL for modifying a view. */
  modifyView(from: View, to: View): string[] {
    // For regular views, CREATE OR REPLACE is used
    if (!to.materialized) {
      const b = pgBuilder(to.schema)
      b.P('CREATE OR REPLACE VIEW').View(to)
      if (to.def) {
        b.P('AS').P(to.def)
      }
      return [b.toString()]
    }

    // For materialized views, drop and recreate
    return [...this.dropView(from), ...this.addView(to)]
  }

  /** Generate SQL for adding a function. */
  addFunc(func: Func): string[] {
    // Body contains the full CREATE [OR REPLACE] FUNCTION statement
    // from pg_get_functiondef — use it directly (matches Go Atlas).
    if (func.body) {
      return [func.body]
    }
    // Fallback: build CREATE FUNCTION from parts
    const b = pgBuilder()
    b.P('CREATE FUNCTION').Func(func)
    b.raw('(')
    if (func.args) {
      b.MapComma(func.args, (arg, _i, b) => {
        if (arg.mode) b.P(arg.mode)
        if (arg.name) b.P(arg.name)
        if (arg.type) b.P(typeDDL(arg.type.type))
        if (arg.default) {
          b.P('DEFAULT')
          if ('X' in arg.default) b.P(arg.default.X)
          else if ('V' in arg.default) b.P(arg.default.V)
        }
      })
    }
    b.raw(')')
    if (func.ret) {
      b.P('RETURNS').P(typeDDL(func.ret.type))
    }
    if (func.lang) {
      b.P('LANGUAGE').P(func.lang)
    }
    return [b.toString()]
  }

  /** Generate SQL for dropping a function. */
  dropFunc(func: Func): string[] {
    const b = pgBuilder()
    b.P('DROP FUNCTION').Func(func)
    // Include arg types for overloaded functions
    if (func.args && func.args.length > 0) {
      b.raw('(')
      b.MapComma(func.args, (arg, _i, b) => {
        if (arg.mode) b.P(arg.mode)
        b.P(typeDDL(arg.type.type))
      })
      b.raw(')')
    }
    return [b.toString()]
  }

  /** Generate SQL for adding a procedure. */
  addProc(proc: Proc): string[] {
    const b = pgBuilder(proc.schema)
    b.P('CREATE PROCEDURE').Func(proc)
    b.raw('(')
    if (proc.args) {
      b.MapComma(proc.args, (arg, _i, b) => {
        if (arg.mode) b.P(arg.mode)
        if (arg.name) b.P(arg.name)
        if (arg.type) b.P(typeDDL(arg.type.type))
      })
    }
    b.raw(')')
    if (proc.lang) {
      b.P('LANGUAGE').P(proc.lang)
    }
    if (proc.body) {
      b.P('AS').P(proc.body)
    }
    return [b.toString()]
  }

  /** Generate SQL for dropping a procedure. */
  dropProc(proc: Proc): string[] {
    const b = pgBuilder(proc.schema)
    b.P('DROP PROCEDURE').Func(proc)
    if (proc.args && proc.args.length > 0) {
      b.raw('(')
      b.MapComma(proc.args, (arg, _i, b) => {
        if (arg.mode) b.P(arg.mode)
        b.P(typeDDL(arg.type.type))
      })
      b.raw(')')
    }
    return [b.toString()]
  }

  /** Generate SQL for adding a trigger. */
  addTrigger(trigger: Trigger): string[] {
    // Trigger body from Postgres is the full CREATE TRIGGER DDL
    if (trigger.body) {
      return [trigger.body]
    }
    // Fallback: reconstruct from parts
    const b = pgBuilder()
    b.P('CREATE TRIGGER').Ident(trigger.name)
    if (trigger.timing) b.P(trigger.timing)
    if (trigger.events && trigger.events.length > 0) {
      b.P(trigger.events.join(' OR '))
    }
    if (trigger.table) {
      b.P('ON').Ident(trigger.table)
    }
    if (trigger.forEach) {
      b.P('FOR EACH').P(trigger.forEach)
    }
    return [b.toString()]
  }

  /** Generate SQL for dropping a trigger. */
  dropTrigger(trigger: Trigger): string[] {
    if (trigger.table) {
      return [`DROP TRIGGER "${trigger.name}" ON "${trigger.table}"`]
    }
    return [`DROP TRIGGER "${trigger.name}"`]
  }

  /** Generate SQL for adding a sequence. */
  addSequence(seq: Sequence): string[] {
    const b = pgBuilder()
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
    const b = pgBuilder()
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
    const b = pgBuilder()
    b.P('ALTER SEQUENCE')
    if (to.schema) {
      b.SchemaResource(to.schema, to.name)
    } else {
      b.Ident(to.name)
    }
    if (from.start !== to.start && to.start !== undefined) {
      b.P('START WITH').Int(to.start)
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

  // -- Enum Operations --

  /** Generate SQL for creating an enum type. */
  addEnum(name: string, values: string[], schema?: string): string[] {
    const b = pgBuilder()
    b.P('CREATE TYPE')
    if (schema) {
      b.SchemaResource(schema, name)
    } else {
      b.Ident(name)
    }
    b.P('AS ENUM')
    b.Wrap((b) => {
      b.MapComma(values, (v, _i, b) => {
        b.raw(quote(v))
      })
    })
    return [b.toString()]
  }

  /** Generate SQL for dropping an enum type. */
  dropEnum(name: string, schema?: string): string[] {
    const b = pgBuilder()
    b.P('DROP TYPE')
    if (schema) {
      b.SchemaResource(schema, name)
    } else {
      b.Ident(name)
    }
    return [b.toString()]
  }

  /** Generate SQL for adding values to an existing enum type. */
  addEnumValues(name: string, fromValues: string[], toValues: string[], schema?: string): string[] {
    const stmts: string[] = []
    const ident = schema ? `"${schema}"."${name}"` : `"${name}"`
    const fromSet = new Set(fromValues)

    for (let i = 0; i < toValues.length; i++) {
      const v = toValues[i]
      if (!fromSet.has(v)) {
        let stmt = `ALTER TYPE ${ident} ADD VALUE ${quote(v)}`
        if (i === 0 && fromValues.length > 0) {
          stmt += ` BEFORE ${quote(fromValues[0])}`
        } else if (i > 0) {
          stmt += ` AFTER ${quote(toValues[i - 1])}`
        }
        stmts.push(stmt)
      }
    }

    return stmts
  }

  // -- Index Helpers --

  /** Generate CREATE INDEX statement. */
  private createIndex(table: Table | View, idx: Index): string[] {
    const b = pgBuilder()
    b.P('CREATE')
    if (idx.unique) b.P('UNIQUE')
    b.P('INDEX')
    if (idx.name) b.Ident(idx.name)
    b.P('ON').Table(table as Table)

    // Index type
    const idxType = findAttr<{ kind: 'index_type'; T: string }>(idx.attrs, 'index_type')
    if (idxType && idxType.T.toUpperCase() !== IndexTypeBTree) {
      b.P('USING').P(idxType.T)
    }

    indexParts(b, idx)

    // Predicate (partial index)
    const pred = findAttr<{ kind: 'predicate'; P: string }>(idx.attrs, 'predicate')
    if (pred?.P) {
      b.P('WHERE').P(pred.P)
    }

    return [b.toString()]
  }

  /** Generate DROP INDEX statement. */
  private dropIndex(table: Table | View, idx: Index): string[] {
    const b = pgBuilder()
    b.P('DROP INDEX')
    if (table.schema) {
      b.SchemaResource(table.schema, idx.name ?? '')
    } else {
      b.Ident(idx.name ?? '')
    }
    return [b.toString()]
  }

  // -- Policy Helpers --

  /** Generate CREATE POLICY statement. */
  private createPolicy(table: Table, policy: Policy): string[] {
    const ref = tableRef(table)
    let stmt = `CREATE POLICY "${policy.name}" ON ${ref}`

    if (policy.permissive === false) {
      stmt += ' AS RESTRICTIVE'
    }

    if (policy.cmd) {
      stmt += ` FOR ${policy.cmd}`
    }

    if (policy.roles && policy.roles.length > 0) {
      stmt += ` TO ${policy.roles.join(', ')}`
    }

    if (policy.using) {
      stmt += ` USING (${policy.using})`
    }

    if (policy.check) {
      stmt += ` WITH CHECK (${policy.check})`
    }

    return [stmt]
  }
}

// -- Shared SQL Helpers --

/** Format a column definition for CREATE TABLE. */
function columnDef(b: Builder, col: Column): void {
  b.Ident(col.name)
  b.P(typeDDL(col.type.type))

  if (!col.type.null) {
    b.P('NOT NULL')
  } else {
    b.P('NULL')
  }

  // Default
  if (col.default) {
    b.P(formatDefault(col))
  }

  // Collation
  const collation = findAttr<{ kind: 'collation'; V: string }>(col.attrs, 'collation')
  if (collation?.V) {
    b.P('COLLATE').Ident(collation.V)
  }

  // Identity
  const identity = findAttr<{ kind: 'identity'; generation: string; sequence?: { start: number; increment: number } }>(
    col.attrs,
    'identity',
  )
  if (identity) {
    const gen = identity.generation || 'BY DEFAULT'
    b.P('GENERATED').P(gen).P('AS IDENTITY')
    const seq = identity.sequence
    if (seq && (seq.start !== 1 || seq.increment !== 1)) {
      b.raw(' (')
      if (seq.start !== 1) b.P(`START WITH ${seq.start}`)
      if (seq.increment !== 1) b.P(`INCREMENT BY ${seq.increment}`)
      b.raw(')')
    }
  }

  // Generated expression
  const generated = findAttr<{ kind: 'generated'; expr: string; type?: string }>(col.attrs, 'generated')
  if (generated && !identity) {
    b.P('GENERATED ALWAYS AS').P(mayWrap(generated.expr)).P('STORED')
  }
}

/** Format a default value expression. */
function formatDefault(col: Column): string {
  if (!col.default) return ''
  if ('V' in col.default) {
    const v = col.default.V
    // Numeric/bool types don't need quoting
    const kind = col.type.type?.kind
    if (kind === 'boolean' || kind === 'decimal' || kind === 'integer' || kind === 'float') {
      return `DEFAULT ${v}`
    }
    return `DEFAULT ${quote(v)}`
  }
  if ('X' in col.default) {
    return `DEFAULT ${col.default.X}`
  }
  return ''
}

/** Format index parts as a parenthesized list. */
function indexParts(b: Builder, idx: Index): void {
  b.Wrap((b) => {
    b.MapComma(idx.parts, (part, _i, b) => {
      if (part.column) {
        b.Ident(part.column)
      } else if (part.expr) {
        b.raw(mayWrap(part.expr))
      }
      if (part.desc) {
        b.P('DESC')
      }
    })
  })
}

/** Format a foreign key definition. */
function fkDef(b: Builder, fk: ForeignKey): void {
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
  if (fk.onUpdate) {
    b.P('ON UPDATE').P(fk.onUpdate)
  }
  if (fk.onDelete) {
    b.P('ON DELETE').P(fk.onDelete)
  }
}

/** Format a CHECK constraint definition. */
function checkDef(b: Builder, chk: Check): void {
  if (chk.name) {
    b.P('CONSTRAINT').Ident(chk.name)
  }
  b.P('CHECK').P(mayWrap(chk.expr))
}

/** Get a schema-qualified table reference. */
function tableRef(table: Table): string {
  if (table.schema) {
    return `"${table.schema}"."${table.name}"`
  }
  return `"${table.name}"`
}

/** Generate COMMENT ON TABLE statement. */
function commentOnTable(table: Table, text: string): string {
  return `COMMENT ON TABLE ${tableRef(table)} IS ${quote(text)}`
}

/** Generate COMMENT ON COLUMN statement. */
function commentOnColumn(table: Table, col: Column, text: string): string {
  return `COMMENT ON COLUMN ${tableRef(table)}."${col.name}" IS ${quote(text)}`
}

/** Generate COMMENT ON INDEX statement. */
function commentOnIndex(table: Table, idx: Index, text: string): string {
  const prefix = table.schema ? `"${table.schema}".` : ''
  return `COMMENT ON INDEX ${prefix}"${idx.name}" IS ${quote(text)}`
}

/** Generate ALTER TABLE ENABLE ROW LEVEL SECURITY statement. */
function enableRLS(table: Table): string {
  return `ALTER TABLE ${tableRef(table)} ENABLE ROW LEVEL SECURITY`
}

/** Generate DROP POLICY statement. */
function dropPolicy(table: Table, policy: Policy): string {
  return `DROP POLICY "${policy.name}" ON ${tableRef(table)}`
}

/** Format a type reference, quoting schema-qualified names (e.g., b.color → "b"."color"). */
function formatTypeRef(t: string): string {
  if (t.includes('.')) {
    const dot = t.lastIndexOf('.')
    const ns = t.slice(0, dot)
    const name = t.slice(dot + 1)
    return `"${ns}"."${name}"`
  }
  return t
}
