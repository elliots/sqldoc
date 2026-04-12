// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/mysql/migrate_oss.go

import type { PlanDriver } from '../internal/plan.ts'
import { Builder, mayWrap } from '../internal/sqlx.ts'
import type { Change } from '../schema/migrate.ts'
import type { Attr, Check, Column, ForeignKey, Func, Index, Proc, Table, Trigger, View } from '../schema/schema.ts'
import { typeDDL } from './convert.ts'
import { IndexTypeBTree, IndexTypeFullText, IndexTypeHash, IndexTypeSpatial, quote } from './driver.ts'
import type { AutoIncrementAttr, EngineAttr, IndexTypeAttr, OnUpdateAttr, SubPartAttr } from './inspect.ts'

// -- Helper: find attribute by kind --

function findAttr<T>(attrs: Attr[] | undefined, kind: string): T | undefined {
  if (!attrs) return undefined
  return attrs.find((a) => 'kind' in a && (a as any).kind === kind) as T | undefined
}

function _hasAttr(attrs: Attr[] | undefined, kind: string): boolean {
  return findAttr(attrs, kind) !== undefined
}

// -- MySQL Builder Factory --

function mysqlBuilder(schema?: string): Builder {
  return new Builder({ quoteOpening: '`', quoteClosing: '`', schema })
}

// -- MysqlPlan --

/**
 * MysqlPlan generates MySQL DDL SQL from schema changes.
 * Implements PlanDriver for use with the generic plan engine.
 */
export class MysqlPlan implements PlanDriver {
  /** Generate SQL for adding a table. */
  addTable(table: Table): string[] {
    if (table.columns.length === 0) {
      throw new Error(`table "${table.name}" has no columns`)
    }
    const b = mysqlBuilder()
    b.P('CREATE TABLE').Table(table).raw('(')

    // Columns
    for (let i = 0; i < table.columns.length; i++) {
      if (i > 0) b.raw(',')
      b.raw('\n  ')
      this.columnDef(b, table, table.columns[i])
    }

    // Primary key
    if (table.primaryKey) {
      b.raw(',\n  ').P('PRIMARY KEY')
      this.indexTypeParts(b, table.primaryKey)
    }

    // Indexes
    for (const idx of table.indexes ?? []) {
      b.raw(',\n  ')
      this.indexDef(b, idx)
    }

    // Foreign keys
    for (const fk of table.foreignKeys ?? []) {
      b.raw(',\n  ')
      this.fkDef(b, fk)
    }

    // Check constraints
    for (const check of table.checks ?? []) {
      b.raw(',\n  ')
      this.checkDef(b, check)
    }

    b.raw('\n)')

    // Table attributes
    this.tableAttrs(b, table.attrs)

    return [b.toString()]
  }

  /** Generate SQL for dropping a table. */
  dropTable(table: Table): string[] {
    const b = mysqlBuilder()
    b.P('DROP TABLE').Table(table)
    return [b.toString()]
  }

  /** Generate SQL for modifying a table (column/index/FK changes). */
  modifyTable(_from: Table, to: Table, changes: Change[]): string[] {
    const stmts: string[] = []

    // Split FK/index modifications into drop + add
    const phase1: Change[] = []
    const phase2: Change[] = []

    for (const c of changes) {
      switch (c.type) {
        case 'modify_foreign_key':
          phase1.push({ type: 'drop_foreign_key', F: c.from })
          phase2.push({ type: 'add_foreign_key', F: c.to })
          break
        case 'modify_index':
          phase1.push({ type: 'drop_index', I: c.from })
          phase2.push({ type: 'add_index', I: c.to })
          break
        default:
          phase2.push(c)
          break
      }
    }

    for (const batch of [phase1, phase2]) {
      if (batch.length === 0) continue
      const b = mysqlBuilder()
      b.P('ALTER TABLE').Table(to)

      let first = true
      for (const change of batch) {
        if (!first) b.raw(',')
        first = false
        b.raw(' ')
        this.alterChange(b, to, change)
      }

      stmts.push(b.toString())
    }

    return stmts
  }

  /** Generate SQL for adding a view. */
  addView(view: View): string[] {
    const b = mysqlBuilder()
    b.P('CREATE VIEW')
      .View(view)
      .P('AS')
      .P(view.def ?? '')
    return [b.toString()]
  }

  /** Generate SQL for dropping a view. */
  dropView(view: View): string[] {
    const b = mysqlBuilder()
    b.P('DROP VIEW').View(view)
    return [b.toString()]
  }

  /** Generate SQL for modifying a view. */
  modifyView(_from: View, to: View): string[] {
    const b = mysqlBuilder()
    b.P('CREATE OR REPLACE VIEW')
      .View(to)
      .P('AS')
      .P(to.def ?? '')
    return [b.toString()]
  }

  /** Generate SQL for adding a function. */
  addFunc(func: Func): string[] {
    return [buildMySQLFuncDDL(func)]
  }

  /** Generate SQL for dropping a function. */
  dropFunc(func: Func): string[] {
    const b = mysqlBuilder()
    b.P('DROP FUNCTION IF EXISTS').Func(func)
    return [b.toString()]
  }

  /** Generate SQL for adding a trigger. */
  addTrigger(trigger: Trigger): string[] {
    if (trigger.body) return [trigger.body]
    // Fallback: construct from components
    const timing = trigger.timing ?? 'BEFORE'
    const event = (trigger.events ?? ['INSERT'])[0]
    const table = trigger.table ?? ''
    return [`CREATE TRIGGER \`${trigger.name}\` ${timing} ${event} ON \`${table}\` FOR EACH ROW BEGIN END`]
  }

  /** Generate SQL for dropping a trigger. */
  dropTrigger(trigger: Trigger): string[] {
    const b = mysqlBuilder()
    b.P('DROP TRIGGER IF EXISTS').Ident(trigger.name)
    return [b.toString()]
  }

  // -- Internal: ALTER TABLE change clauses --

  protected alterChange(b: Builder, table: Table, change: Change): void {
    switch (change.type) {
      case 'add_column':
        b.P('ADD COLUMN')
        this.columnDef(b, table, change.C)
        break

      case 'modify_column':
        if (change.to.name !== change.from.name) {
          b.P('CHANGE COLUMN').Ident(change.from.name)
        } else {
          b.P('MODIFY COLUMN')
        }
        this.columnDef(b, table, change.to)
        break

      case 'drop_column':
        b.P('DROP COLUMN').Ident(change.C.name)
        break

      case 'add_index':
        b.P('ADD')
        this.indexDef(b, change.I)
        break

      case 'drop_index':
        b.P('DROP INDEX').Ident(change.I.name ?? '')
        break

      case 'add_primary_key':
        b.P('ADD PRIMARY KEY')
        this.indexTypeParts(b, change.P)
        break

      case 'drop_primary_key':
        b.P('DROP PRIMARY KEY')
        break

      case 'modify_primary_key':
        b.P('DROP PRIMARY KEY, ADD PRIMARY KEY')
        this.indexTypeParts(b, change.to)
        break

      case 'add_foreign_key':
        b.P('ADD')
        this.fkDef(b, change.F)
        break

      case 'drop_foreign_key':
        b.P('DROP FOREIGN KEY').Ident(change.F.symbol ?? '')
        break

      case 'add_check':
        b.P('ADD')
        this.checkDef(b, change.C)
        break

      case 'drop_check':
        b.P('DROP CONSTRAINT').Ident(change.C.name ?? '')
        break

      case 'add_attr':
      case 'modify_attr':
      case 'drop_attr': {
        const attr = change.type === 'drop_attr' ? change.A : change.type === 'modify_attr' ? change.to : change.A
        this.tableAttrClause(b, attr)
        break
      }

      case 'rename_column':
        b.P('RENAME COLUMN').Ident(change.from.name).P('TO').Ident(change.to.name)
        break

      case 'rename_index':
        b.P('RENAME INDEX')
          .Ident(change.from.name ?? '')
          .P('TO')
          .Ident(change.to.name ?? '')
        break
    }
  }

  // -- Internal: column definition --

  protected columnDef(b: Builder, _table: Table, col: Column): void {
    let typ: string
    try {
      typ = typeDDL(col.type.type)
    } catch {
      typ = col.type.raw ?? col.type.type.T
    }
    b.Ident(col.name).P(typ)

    // Charset (before NULL/NOT NULL)
    const charset = findAttr<{ kind: 'charset'; V: string }>(col.attrs, 'charset')
    if (charset) {
      b.P('CHARSET', charset.V)
    }

    // Generated expression
    const genExpr = findAttr<{ kind: 'generated'; expr: string; type?: string }>(col.attrs, 'generated')
    if (genExpr) {
      b.P('AS', mayWrap(genExpr.expr), genExpr.type ?? '')
    }

    // NULL / NOT NULL
    if (!genExpr) {
      if (!col.type.null) {
        b.P('NOT')
      }
      b.P('NULL')
    }

    // Default value
    this.columnDefault(b, col)

    // Column attrs
    for (const a of col.attrs ?? []) {
      if (!('kind' in a)) continue
      const kind = (a as any).kind
      switch (kind) {
        case 'charset':
          // Already handled above
          break
        case 'collation': {
          const collation = a as { kind: 'collation'; V: string }
          b.P('COLLATE', collation.V)
          break
        }
        case 'on_update': {
          const ou = a as unknown as OnUpdateAttr
          b.P('ON UPDATE', ou.A)
          break
        }
        case 'auto_increment':
          b.P('AUTO_INCREMENT')
          break
      }
    }
  }

  // -- Internal: column default --

  protected columnDefault(b: Builder, col: Column): void {
    if (!col.default) return
    const d = col.default
    if ('V' in d) {
      let v = d.V
      // Quote non-numeric defaults
      if (!hasNumericDefault(col.type.type) && !isHex(v)) {
        v = quote(v)
      }
      b.P('DEFAULT', v)
    } else if ('X' in d) {
      b.P('DEFAULT', d.X)
    }
  }

  // -- Internal: index definition --

  protected indexDef(b: Builder, idx: Index): void {
    const indexType = this.getIndexType(idx.attrs)

    if (idx.unique) {
      b.P('UNIQUE')
    } else if (indexType === IndexTypeFullText) {
      b.P(IndexTypeFullText)
    } else if (indexType === IndexTypeSpatial) {
      b.P(IndexTypeSpatial)
    }

    b.P('INDEX').Ident(idx.name ?? '')
    this.indexTypeParts(b, idx)

    // Comment
    const comment = findAttr<{ kind: 'comment'; text: string }>(idx.attrs, 'comment')
    if (comment) {
      b.P('COMMENT', quote(comment.text))
    }
  }

  protected indexTypeParts(b: Builder, idx: Index): void {
    const indexType = this.getIndexType(idx.attrs)
    // Skip BTREE as it is the default; only emit for HASH
    if (indexType === IndexTypeHash) {
      b.P('USING', IndexTypeHash)
    }

    b.raw('(')
    for (let i = 0; i < idx.parts.length; i++) {
      if (i > 0) b.raw(', ')
      const part = idx.parts[i]
      if (part.column) {
        b.Ident(part.column)
      } else if (part.expr) {
        b.raw(mayWrap(part.expr))
      }
      // SubPart (index prefix length)
      const subPart = findAttr<SubPartAttr>(part.attrs, 'sub_part')
      if (subPart) {
        b.raw(`(${subPart.len})`)
      }
      if (part.desc) {
        b.P('DESC')
      }
    }
    b.raw(')')
  }

  // -- Internal: foreign key definition --

  protected fkDef(b: Builder, fk: ForeignKey): void {
    if (fk.symbol) {
      b.P('CONSTRAINT').Ident(fk.symbol)
    }
    b.P('FOREIGN KEY')
    b.raw('(')
    b.raw(fk.columns.map((c) => `\`${c}\``).join(', '))
    b.raw(')')
    b.P('REFERENCES').Ident(fk.refTable)
    b.raw('(')
    b.raw(fk.refColumns.map((c) => `\`${c}\``).join(', '))
    b.raw(')')
    if (fk.onUpdate) b.P('ON UPDATE', fk.onUpdate)
    if (fk.onDelete) b.P('ON DELETE', fk.onDelete)
  }

  // -- Internal: check definition --

  protected checkDef(b: Builder, check: Check): void {
    if (check.name) {
      b.P('CONSTRAINT').Ident(check.name)
    }
    b.P('CHECK', mayWrap(check.expr))
  }

  // -- Internal: table attributes --

  protected tableAttrs(b: Builder, attrs: Attr[] | undefined): void {
    if (!attrs) return
    for (const a of attrs) {
      this.tableAttrClause(b, a)
    }
  }

  protected tableAttrClause(b: Builder, a: Attr): void {
    if (!('kind' in a)) return
    const kind = (a as any).kind
    switch (kind) {
      case 'auto_increment': {
        const ai = a as unknown as AutoIncrementAttr
        if (ai.V > 1) b.P('AUTO_INCREMENT', String(ai.V))
        break
      }
      case 'engine': {
        const eng = a as unknown as EngineAttr
        if (!eng.default) b.P('ENGINE', eng.V)
        break
      }
      case 'charset': {
        const cs = a as { kind: 'charset'; V: string }
        b.P('CHARSET', cs.V)
        break
      }
      case 'collation': {
        const co = a as { kind: 'collation'; V: string }
        b.P('COLLATE', co.V)
        break
      }
      case 'comment': {
        const cm = a as { kind: 'comment'; text: string }
        b.P('COMMENT', quote(cm.text))
        break
      }
    }
  }

  // -- Internal helpers --

  private getIndexType(attrs: Attr[] | undefined): string {
    const it = findAttr<IndexTypeAttr>(attrs, 'index_type')
    return (it?.T ?? IndexTypeBTree).toUpperCase()
  }
}

// -- Build MySQL FUNCTION DDL --

function buildMySQLFuncDDL(f: Func): string {
  let result = 'CREATE FUNCTION '
  if (f.schema) result += `\`${f.schema}\`.`
  result += `\`${f.name}\`(`
  for (let i = 0; i < (f.args ?? []).length; i++) {
    if (i > 0) result += ', '
    const a = f.args![i]
    if (a.name) result += `\`${a.name}\` `
    if (a.type) {
      try {
        result += typeDDL(a.type.type)
      } catch {
        result += a.type.raw ?? a.type.type.T
      }
    }
  }
  result += ')'
  if (f.ret) {
    result += ' RETURNS '
    try {
      result += typeDDL(f.ret.type)
    } catch {
      result += f.ret.raw ?? f.ret.type.T
    }
  }
  result += '\n'
  result += f.body ?? ''
  return result
}

// -- Build MySQL PROCEDURE DDL --

function _buildMySQLProcDDL(p: Proc): string {
  let result = 'CREATE PROCEDURE '
  if (p.schema) result += `\`${p.schema}\`.`
  result += `\`${p.name}\`(`
  for (let i = 0; i < (p.args ?? []).length; i++) {
    if (i > 0) result += ', '
    const a = p.args![i]
    if (a.mode && a.mode !== 'IN') {
      result += `${a.mode} `
    }
    if (a.name) result += `\`${a.name}\` `
    if (a.type) {
      try {
        result += typeDDL(a.type.type)
      } catch {
        result += a.type.raw ?? a.type.type.T
      }
    }
  }
  result += ')\n'
  result += p.body ?? ''
  return result
}

// -- Internal helpers --

function hasNumericDefault(t: import('../schema/schema.ts').SchemaType): boolean {
  switch (t.kind) {
    case 'boolean':
    case 'integer':
    case 'decimal':
    case 'float':
      return true
    default:
      return false
  }
}

function isHex(x: string): boolean {
  return x.length > 2 && x.slice(0, 2).toLowerCase() === '0x'
}
