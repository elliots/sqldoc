// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/mysql/inspect_oss.go

import { isQuoted, mayWrap, validString } from '../internal/sqlx.ts'
import type { ExecQuerier, InspectOptions, Inspector, InspectRealmOption } from '../schema/inspect.ts'
import { InspectMode, NotExistError } from '../schema/inspect.ts'
import type {
  Attr,
  Check,
  Column,
  ColumnType,
  Func,
  FuncArg,
  IndexPart,
  Proc,
  Realm,
  Schema,
  Table,
  Trigger,
  View,
} from '../schema/schema.ts'
import {
  autoIncrement as autoIncrementConst,
  columnsExprQuery,
  columnsQuery,
  currentTS,
  defaultGen,
  fksQuery,
  indexesExprQuery,
  indexesNoCommentQuery,
  indexesQuery,
  marChecksQuery,
  myChecksQuery,
  nArgs,
  parametersQuery,
  parseType,
  routinesQuery,
  schemasQuery,
  schemasQueryArgs,
  TypeJSON,
  TypeLongText,
  tablesQuery,
  tablesQueryArgs,
  triggersQuery,
  unescapeStr,
  viewsQuery,
} from './driver.ts'

// -- MySQL-specific attribute types --

/** AutoIncrement attribute for columns/tables. */
export interface AutoIncrementAttr {
  kind: 'auto_increment'
  V: number
}

/** Engine attribute for tables. */
export interface EngineAttr {
  kind: 'engine'
  V: string
  default?: boolean
}

/** CREATE OPTIONS attribute. */
export interface CreateOptionsAttr {
  kind: 'create_options'
  V: string
}

/** ON UPDATE attribute for timestamp columns. */
export interface OnUpdateAttr {
  kind: 'on_update'
  A: string
}

/** SubPart attribute for index prefix length. */
export interface SubPartAttr {
  kind: 'sub_part'
  len: number
}

/** IndexType attribute for index type (BTREE, HASH, etc). */
export interface IndexTypeAttr {
  kind: 'index_type'
  T: string
}

/** Enforced attribute for CHECK constraints. */
export interface EnforcedAttr {
  kind: 'enforced'
  V: boolean
}

/** SystemVersioned attribute for MariaDB system-versioned tables. */
export interface SystemVersionedAttr {
  kind: 'system_versioned'
}

/** Partition attribute for partitioned tables. */
export interface PartitionAttr {
  kind: 'partition'
  T: string
  expr: string
}

// -- MySQL Version Helper --

export interface MysqlVersion {
  version: string
  maria: boolean
  major: number
  minor: number
  patch: number
}

/** Detect if connected to MariaDB (vs MySQL). */
export function isMariaDB(versionStr: string): boolean {
  return versionStr.toLowerCase().includes('mariadb')
}

/** Parse MySQL/MariaDB version string into components. */
export function parseVersion(versionStr: string): MysqlVersion {
  const maria = isMariaDB(versionStr)
  // Extract version numbers: "8.0.31" or "5.5.5-10.6.11-MariaDB"
  let numStr = versionStr
  if (maria) {
    // MariaDB versions can be "5.5.5-10.6.11-MariaDB" or "10.6.11-MariaDB"
    const parts = versionStr.split('-')
    for (const p of parts) {
      if (/^\d+\.\d+\.\d+$/.test(p)) {
        // Take the MariaDB version, not the MySQL compat version
        const [major] = p.split('.').map(Number)
        if (major >= 10 || parts.indexOf(p) > 0) {
          numStr = p
          break
        }
      }
    }
  }
  const match = numStr.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return { version: versionStr, maria, major: 0, minor: 0, patch: 0 }
  }
  return {
    version: versionStr,
    maria,
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  }
}

/** Compare version >= target. Target is "major.minor.patch". */
export function versionGTE(v: MysqlVersion, target: string): boolean {
  const [major, minor, patch] = target.split('.').map(Number)
  if (v.major !== major) return v.major > major
  if (v.minor !== minor) return v.minor > minor
  return v.patch >= patch
}

/** Compare version < target. */
export function versionLT(v: MysqlVersion, target: string): boolean {
  return !versionGTE(v, target)
}

/** Reports if MySQL supports CHECK constraints (MySQL 8.0.16+ or MariaDB 10.2.1+). */
function supportsCheck(v: MysqlVersion): boolean {
  if (v.maria) return versionGTE(v, '10.2.1')
  return versionGTE(v, '8.0.16')
}

/** Reports if MySQL supports generated columns. */
function supportsGeneratedColumns(v: MysqlVersion): boolean {
  if (v.maria) return versionGTE(v, '5.2.0')
  return versionGTE(v, '5.7.0')
}

/** Reports if MySQL supports expression indexes. */
function supportsIndexExpr(v: MysqlVersion): boolean {
  if (v.maria) return false
  return versionGTE(v, '8.0.13')
}

/** Reports if MySQL supports index comments. */
function supportsIndexComment(_v: MysqlVersion): boolean {
  // All MySQL 5.5+ and MariaDB support index comments
  return true
}

/** Reports if MySQL supports expression defaults. */
function supportsExprDefault(v: MysqlVersion): boolean {
  if (v.maria) return versionGTE(v, '10.2.1')
  return versionGTE(v, '8.0.13')
}

// -- Extra Column Attribute Parsing --

interface ExtraAttr {
  autoinc: boolean
  onUpdate: string
  generatedType: string
  defaultGenerated: boolean
}

const reGenerateType = /^(stored|persistent|virtual) generated$/i
const reTimeOnUpdate = /^(?:default_generated )?on update (current_timestamp(?:\(\d?\))?)$/i
const reCurrTimestamp = /^current_timestamp(?:\(\d?\))?$/i

function parseExtra(extra: string): ExtraAttr {
  const attr: ExtraAttr = { autoinc: false, onUpdate: '', generatedType: '', defaultGenerated: false }
  const el = extra.toLowerCase()

  if (el === '' || el === 'null') return attr
  if (el === defaultGen) {
    attr.defaultGenerated = true
    return attr
  }
  if (el === autoIncrementConst) {
    attr.autoinc = true
    return attr
  }
  const onUpdateMatch = reTimeOnUpdate.exec(extra)
  if (onUpdateMatch) {
    attr.onUpdate = onUpdateMatch[1]
    return attr
  }
  const genMatch = reGenerateType.exec(extra)
  if (genMatch) {
    attr.generatedType = genMatch[1]
    return attr
  }

  // Unknown extra; just return without error to be lenient
  return attr
}

// -- MySQL Inspector --

/**
 * MysqlInspector inspects MySQL/MariaDB databases using information_schema queries.
 */
export class MysqlInspector implements Inspector {
  protected db: ExecQuerier
  protected v: MysqlVersion

  private versionDetected = false

  constructor(db: ExecQuerier, version?: string) {
    this.db = db
    this.v = version ? parseVersion(version) : { version: '8.0.31', maria: false, major: 8, minor: 0, patch: 31 }
  }

  private async detectVersion(): Promise<void> {
    if (this.versionDetected) return
    this.versionDetected = true
    const result = await this.db.query('SELECT VERSION() AS v', [])
    const row = result.rows[0] as any
    const versionStr = row?.v ?? row?.['VERSION()']
    if (versionStr) {
      this.v = parseVersion(versionStr)
    }
  }

  async inspectSchema(name: string, opts?: InspectOptions): Promise<Schema> {
    await this.detectVersion()
    const schemas = await this.querySchemas({ schemas: [name] })
    if (schemas.length === 0) {
      throw new NotExistError(`mysql: schema "${name}" was not found`)
    }
    if (schemas.length > 1) {
      throw new Error(`mysql: ${schemas.length} schemas were found for "${name}"`)
    }

    const mode = opts?.mode ?? InspectMode.InspectAll
    const realm: Realm = { schemas }

    if (mode & InspectMode.InspectTables) {
      await this.inspectTables(realm, opts)
    }
    if (mode & InspectMode.InspectViews) {
      await this.inspectViews(realm)
    }
    if (mode & InspectMode.InspectFuncs) {
      await this.inspectFuncs(realm)
    }
    if (mode & InspectMode.InspectTriggers) {
      await this.inspectTriggers(realm)
    }

    return schemas[0]
  }

  async inspectRealm(opts?: InspectRealmOption): Promise<Realm> {
    await this.detectVersion()
    const schemas = await this.querySchemas(opts)
    const mode = opts?.mode ?? InspectMode.InspectAll
    // Set realm-level charset/collation from connection defaults (matches Go)
    const realmAttrs: Attr[] = []
    if (schemas.length > 0 && schemas[0].attrs) {
      const cs = schemas[0].attrs.find((a: any) => (a as any).kind === 'charset')
      const co = schemas[0].attrs.find((a: any) => (a as any).kind === 'collation')
      if (cs) realmAttrs.push(cs)
      if (co) realmAttrs.push(co)
    }
    const realm: Realm = { schemas, attrs: realmAttrs.length > 0 ? realmAttrs : undefined }

    if (schemas.length > 0) {
      if (mode & InspectMode.InspectTables) {
        await this.inspectTables(realm)
      }
      if (mode & InspectMode.InspectViews) {
        await this.inspectViews(realm)
      }
      if (mode & InspectMode.InspectFuncs) {
        await this.inspectFuncs(realm)
      }
      if (mode & InspectMode.InspectTriggers) {
        await this.inspectTriggers(realm)
      }
    }

    return realm
  }

  // -- Query schemas --

  protected async querySchemas(opts?: InspectRealmOption): Promise<Schema[]> {
    let query = schemasQuery
    const args: unknown[] = []

    if (opts?.schemas && opts.schemas.length > 0) {
      if (opts.schemas.length === 1 && opts.schemas[0] === '') {
        query = schemasQueryArgs.replace('%s', '= SCHEMA()')
      } else if (opts.schemas.length === 1) {
        query = schemasQueryArgs.replace('%s', '= ?')
        args.push(opts.schemas[0])
      } else {
        query = schemasQueryArgs.replace('%s', `IN (${nArgs(opts.schemas.length)})`)
        args.push(...opts.schemas)
      }
    }

    const result = await this.db.query(query, args)
    const schemas: Schema[] = []
    for (const row of result.rows) {
      const name = row.SCHEMA_NAME as string
      const charset = row.DEFAULT_CHARACTER_SET_NAME as string
      const collation = row.DEFAULT_COLLATION_NAME as string
      schemas.push({
        name,
        attrs: [
          { kind: 'charset' as const, V: charset },
          { kind: 'collation' as const, V: collation },
        ],
      })
    }
    return schemas
  }

  // -- Inspect tables --

  protected async inspectTables(realm: Realm, opts?: InspectOptions): Promise<void> {
    await this.queryTables(realm, opts)
    for (const s of realm.schemas) {
      if (!s.tables || s.tables.length === 0) continue
      await this.queryColumns(s)
      await this.queryIndexes(s)
      await this.queryForeignKeys(s)
      await this.queryChecks(s)
    }
  }

  protected async queryTables(realm: Realm, opts?: InspectOptions): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    let query: string
    const args: unknown[] = [...schemaNames]

    if (opts?.tables && opts.tables.length > 0) {
      query = tablesQueryArgs.replace('%s', nArgs(schemaNames.length)).replace('%s', nArgs(opts.tables.length))
      args.push(...opts.tables)
    } else {
      query = tablesQuery.replace('%s', nArgs(schemaNames.length))
    }

    const result = await this.db.query(query, args)
    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const tSchema = row.TABLE_SCHEMA as string
      const tName = row.TABLE_NAME as string
      const s = schemaMap.get(tSchema)
      if (!s) continue

      const t: Table = { name: tName, columns: [] }
      const attrs: Attr[] = []

      const charset = row.CHARACTER_SET_NAME as string | null
      if (charset && validString(charset)) {
        attrs.push({ kind: 'charset' as const, V: charset })
      }
      const collation = row.TABLE_COLLATION as string | null
      if (collation && validString(collation)) {
        attrs.push({ kind: 'collation' as const, V: collation })
      }
      const comment = row.TABLE_COMMENT as string | null
      if (comment && validString(comment)) {
        attrs.push({ kind: 'comment' as const, text: comment })
      }
      const options = row.CREATE_OPTIONS as string | null
      if (options && validString(options)) {
        attrs.push({ kind: 'create_options', V: options } as unknown as Attr)
      }
      const engine = row.ENGINE as string | null
      const defaultEngine = row.DEFAULT_ENGINE
      if (engine && validString(engine)) {
        attrs.push({ kind: 'engine', V: engine, default: !!defaultEngine } as unknown as Attr)
      }
      const autoinc = row.AUTO_INCREMENT as number | null
      if (autoinc != null) {
        attrs.push({ kind: 'auto_increment', V: autoinc } as unknown as Attr)
      }

      // MariaDB system-versioned table detection
      if (this.v.maria && options?.includes('system versioned')) {
        attrs.push({ kind: 'system_versioned' } as unknown as Attr)
      }

      if (attrs.length > 0) t.attrs = attrs
      if (!s.tables) s.tables = []
      s.tables.push(t)
    }
  }

  // -- Inspect columns --

  protected async queryColumns(s: Schema): Promise<void> {
    const tableNames = (s.tables ?? []).map((t) => t.name)
    if (tableNames.length === 0) return

    let query = supportsGeneratedColumns(this.v) ? columnsExprQuery : columnsQuery
    query = query.replace('%s', nArgs(tableNames.length))
    const args: unknown[] = [s.name, ...tableNames]

    const result = await this.db.query(query, args)
    const tableMap = new Map((s.tables ?? []).map((t) => [t.name, t]))

    for (const row of result.rows) {
      const tableName = row.TABLE_NAME as string
      const t = tableMap.get(tableName)
      if (!t) continue

      const name = row.COLUMN_NAME as string
      const rawType = row.COLUMN_TYPE as string
      const commentStr = row.COLUMN_COMMENT as string | null
      const nullable = row.IS_NULLABLE as string
      const defaults = row.COLUMN_DEFAULT as string | null
      const extra = (row.EXTRA as string) || ''
      const charsetCol = row.CHARACTER_SET_NAME as string | null
      const collationCol = row.COLLATION_NAME as string | null
      const genExpr = row.GENERATION_EXPRESSION as string | null

      const colType = parseType(rawType)
      // Remove zero-value fields (match Go omitempty)
      if ('unsigned' in colType && !(colType as any).unsigned) delete (colType as any).unsigned
      if ('size' in colType && (colType as any).size === 0) delete (colType as any).size
      if ('precision' in colType && (colType as any).precision === 0) delete (colType as any).precision
      if ('scale' in colType && (colType as any).scale === 0) delete (colType as any).scale
      const ct: ColumnType = {
        type: colType,
        raw: rawType,
      }
      if (nullable === 'YES') ct.null = true
      const col: Column = { name, type: ct }
      const attrs: Attr[] = []

      // Parse EXTRA column
      const extraAttr = parseExtra(extra)

      if (extraAttr.autoinc) {
        attrs.push({ kind: 'auto_increment', V: 0 } as unknown as Attr)
      }
      if (extraAttr.onUpdate) {
        attrs.push({ kind: 'on_update', A: extraAttr.onUpdate } as unknown as Attr)
      }

      // Generated expression
      if (genExpr && genExpr !== '') {
        let x = genExpr
        if (!this.v.maria) {
          x = unescapeStr(x)
        }
        attrs.push({
          kind: 'generated' as const,
          expr: x,
          type: extraAttr.generatedType || undefined,
        })
      }

      // Default value
      if (defaults !== null && defaults !== undefined) {
        if (this.v.maria) {
          col.default = this.marDefaultExpr(colType, defaults)
        } else {
          col.default = this.myDefaultExpr(colType, defaults, extraAttr)
        }
      }

      // Comment
      if (commentStr && validString(commentStr)) {
        attrs.push({ kind: 'comment' as const, text: commentStr })
      }
      // Charset
      if (charsetCol && validString(charsetCol)) {
        attrs.push({ kind: 'charset' as const, V: charsetCol })
      }
      // Collation
      if (collationCol && validString(collationCol)) {
        attrs.push({ kind: 'collation' as const, V: collationCol })
      }

      if (attrs.length > 0) col.attrs = attrs
      t.columns.push(col)
    }
  }

  // -- Default expression handling (MySQL) --

  protected myDefaultExpr(
    colType: import('../schema/schema.ts').SchemaType,
    x: string,
    attr: ExtraAttr,
  ): import('../schema/schema.ts').Expr | undefined {
    if (supportsExprDefault(this.v) && attr.defaultGenerated) {
      if (colType.kind === 'time' && reCurrTimestamp.test(x)) {
        return { X: x }
      }
      return { X: mayWrap(unescapeStr(x)) }
    }
    switch (colType.kind) {
      case 'binary':
        if (isHex(x)) return { V: x }
        break
      case 'boolean':
      case 'integer':
      case 'decimal':
      case 'float':
        return { V: x }
      case 'time':
        if (reCurrTimestamp.test(x)) return { X: x }
        break
    }
    return { V: quoteDefault(x) }
  }

  // -- Default expression handling (MariaDB) --

  /** MariaDB-specific default expression normalization. */
  protected marDefaultExpr(
    colType: import('../schema/schema.ts').SchemaType,
    x: string,
  ): import('../schema/schema.ts').Expr | undefined {
    // Unlike MySQL, NULL means default to NULL or no default.
    if (x === 'NULL') return undefined

    // From MariaDB 10.2.7, string-based literals are quoted
    if (versionGTE(this.v, '10.2.7') && isQuoted(x, "'")) {
      return { V: x }
    }

    // Manual check if expression is literal
    switch (colType.kind) {
      case 'boolean':
      case 'integer':
      case 'decimal':
      case 'float':
        if (!Number.isNaN(parseFloat(x))) return { V: x }
        break
      case 'time':
        if (x.toLowerCase() === currentTS) return { X: x }
        break
    }

    if (!supportsExprDefault(this.v)) {
      return { V: quoteDefault(x) }
    }
    return { X: mayWrap(x) }
  }

  // -- Inspect indexes --

  protected async queryIndexes(s: Schema): Promise<void> {
    const tables = s.tables ?? []
    if (tables.length === 0) return
    const tableNames = tables.map((t) => t.name)

    let query = indexesNoCommentQuery
    if (supportsIndexComment(this.v)) query = indexesQuery
    if (supportsIndexExpr(this.v)) query = indexesExprQuery
    query = query.replace('%s', nArgs(tableNames.length))
    const args: unknown[] = [s.name, ...tableNames]

    const result = await this.db.query(query, args)
    const tableMap = new Map(tables.map((t) => [t.name, t]))

    // Group index parts by table + index name
    for (const row of result.rows) {
      const tableName = row.TABLE_NAME as string
      const indexName = row.INDEX_NAME as string
      const columnName = row.COLUMN_NAME as string | null
      const nonUnique = row.NON_UNIQUE as boolean | number | null
      const _seqNo = row.SEQ_IN_INDEX as number
      const indexType = row.INDEX_TYPE as string
      const desc = row.DESC as boolean | number | null
      const comment = row.INDEX_COMMENT as string | null
      const subPart = row.SUB_PART as string | number | null
      const expr = row.EXPRESSION as string | null

      const t = tableMap.get(tableName)
      if (!t) continue

      // Handle PRIMARY KEY
      if (indexName === 'PRIMARY') {
        if (!t.primaryKey) {
          t.primaryKey = { name: 'PRI', parts: [], attrs: [{ kind: 'index_type', T: indexType } as unknown as Attr] }
        }
        const part: IndexPart = {}
        if (columnName && validString(columnName)) {
          part.column = columnName
          if (subPart != null && String(subPart) !== '' && indexType !== 'SPATIAL') {
            part.attrs = [{ kind: 'sub_part', len: Number(subPart) } as unknown as Attr]
          }
        } else if (expr && validString(expr)) {
          part.expr = unescapeStr(expr)
        }
        if (desc) part.desc = true
        t.primaryKey.parts.push(part)
        continue
      }

      // Regular index
      if (!t.indexes) t.indexes = []
      let idx = t.indexes.find((i) => i.name === indexName)
      if (!idx) {
        idx = {
          name: indexName,
          unique: !nonUnique || undefined,
          parts: [],
          attrs: [{ kind: 'index_type', T: indexType } as unknown as Attr],
        }
        if (comment && validString(comment)) {
          idx.attrs!.push({ kind: 'comment' as const, text: comment })
        }
        t.indexes.push(idx)
      }

      const part: IndexPart = {}
      if (expr && validString(expr)) {
        part.expr = unescapeStr(expr)
      } else if (columnName && validString(columnName)) {
        part.column = columnName
        if (subPart != null && String(subPart) !== '' && indexType !== 'SPATIAL') {
          part.attrs = [{ kind: 'sub_part', len: Number(subPart) } as unknown as Attr]
        }
      }
      if (desc) part.desc = true
      idx.parts.push(part)
    }
  }

  // -- Inspect foreign keys --

  protected async queryForeignKeys(s: Schema): Promise<void> {
    const tables = s.tables ?? []
    if (tables.length === 0) return
    const tableNames = tables.map((t) => t.name)

    const query = fksQuery.replace('%s', nArgs(tableNames.length))
    // fksQuery has two schema name params
    const args: unknown[] = [s.name, s.name, ...tableNames]

    const result = await this.db.query(query, args)
    const tableMap = new Map(tables.map((t) => [t.name, t]))

    // Group FK columns by constraint name + table
    const fkMap = new Map<
      string,
      {
        table: Table
        symbol: string
        columns: string[]
        refTable: string
        refSchema?: string
        refColumns: string[]
        onUpdate?: string
        onDelete?: string
      }
    >()

    for (const row of result.rows) {
      const symbol = row.CONSTRAINT_NAME as string
      const tableName = row.TABLE_NAME as string
      const columnName = row.COLUMN_NAME as string
      const refTableName = row.REFERENCED_TABLE_NAME as string
      const refColumnName = row.REFERENCED_COLUMN_NAME as string
      const refSchema = row.REFERENCED_TABLE_SCHEMA as string | null
      const onUpdate = row.UPDATE_RULE as string
      const onDelete = row.DELETE_RULE as string

      const key = `${tableName}\x00${symbol}`
      let fk = fkMap.get(key)
      if (!fk) {
        const t = tableMap.get(tableName)
        if (!t) continue
        fk = {
          table: t,
          symbol,
          columns: [],
          refTable: refTableName,
          refSchema: refSchema || undefined,
          refColumns: [],
          onUpdate: (onUpdate as any) || undefined,
          onDelete: (onDelete as any) || undefined,
        }
        fkMap.set(key, fk)
      }
      fk.columns.push(columnName)
      fk.refColumns.push(refColumnName)
    }

    for (const fk of fkMap.values()) {
      if (!fk.table.foreignKeys) fk.table.foreignKeys = []
      fk.table.foreignKeys.push({
        symbol: fk.symbol,
        columns: fk.columns,
        refTable: fk.refTable,
        refSchema: fk.refSchema,
        refColumns: fk.refColumns,
        onUpdate: fk.onUpdate as any,
        onDelete: fk.onDelete as any,
      })
    }
  }

  // -- Inspect check constraints --
  // MariaDB CHECK constraint filtering and JSON alias handling

  protected async queryChecks(s: Schema): Promise<void> {
    if (!supportsCheck(this.v)) return

    const tables = s.tables ?? []
    if (tables.length === 0) return
    const tableNames = tables.map((t) => t.name)

    // MariaDB uses a different query
    let query = this.v.maria ? marChecksQuery : myChecksQuery
    query = query.replace('%s', nArgs(tableNames.length))
    const args: unknown[] = [s.name, ...tableNames]

    const result = await this.db.query(query, args)
    const tableMap = new Map(tables.map((t) => [t.name, t]))

    for (const row of result.rows) {
      const tableName = row.TABLE_NAME as string
      const checkName = row.CONSTRAINT_NAME as string
      const clause = row.CHECK_CLAUSE as string
      const enforced = row.ENFORCED as string

      const t = tableMap.get(tableName)
      if (!t) continue

      const check: Check = { name: checkName, expr: '' }

      if (this.v.maria) {
        check.expr = clause

        // MariaDB JSON alias handling:
        // MariaDB uses longtext as the underlying type for JSON columns.
        // For versions >= 10.4.3, a CHECK constraint is automatically created
        // with the form json_valid(`<column>`). Detect this and remap the column
        // to JSON type, skipping the implicit CHECK constraint.
        const col = t.columns.find((c) => c.name === checkName)
        if (col && col.type.raw === TypeLongText && check.expr === `json_valid(\`${col.name}\`)`) {
          // Remap column type to JSON
          col.type.type = { kind: 'json', T: TypeJSON }
          col.type.raw = TypeJSON
          // Unset charset/collation attrs (only valid for character types)
          if (col.attrs) {
            col.attrs = col.attrs.filter(
              (a) => !('kind' in a && ((a as any).kind === 'charset' || (a as any).kind === 'collation')),
            )
          }
          // Skip adding this CHECK to the table -- it's implicit
          continue
        }
      } else {
        check.expr = unescapeStr(clause)
        // The ENFORCED attribute is not supported by MariaDB.
        // Skip adding it if the CHECK is ENFORCED (default).
        if (enforced === 'NO') {
          check.attrs = [{ kind: 'enforced', V: false } as unknown as Attr]
        }
      }

      if (!t.checks) t.checks = []
      t.checks.push(check)
    }
  }

  // -- Inspect views --

  protected async inspectViews(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const query = viewsQuery.replace('%s', nArgs(schemaNames.length))
    const args: unknown[] = schemaNames
    const result = await this.db.query(query, args)
    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const sName = row.TABLE_SCHEMA as string
      const vName = row.TABLE_NAME as string
      const def = row.VIEW_DEFINITION as string
      const checkOpt = row.CHECK_OPTION as string

      const s = schemaMap.get(sName)
      if (!s) continue

      const v: View = { name: vName, def }
      if (checkOpt && checkOpt.toUpperCase() !== 'NONE') {
        if (!v.attrs) v.attrs = []
        v.attrs.push({ kind: 'comment' as const, text: `CHECK_OPTION=${checkOpt}` })
      }

      if (!s.views) s.views = []
      s.views.push(v)
    }
  }

  // -- Inspect triggers --

  protected async inspectTriggers(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const query = triggersQuery.replace('%s', nArgs(schemaNames.length))
    const args: unknown[] = schemaNames
    const result = await this.db.query(query, args)
    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const sName = row.TRIGGER_SCHEMA as string
      const tName = row.TRIGGER_NAME as string
      const tblName = row.EVENT_OBJECT_TABLE as string
      const timing = row.ACTION_TIMING as string
      const event = row.EVENT_MANIPULATION as string
      const body = row.ACTION_STATEMENT as string

      const s = schemaMap.get(sName)
      if (!s) continue

      const trigger: Trigger = {
        name: tName,
        table: tblName,
        timing: timing.toUpperCase(),
        events: [event.toUpperCase()],
        forEach: 'ROW',
        body: `CREATE TRIGGER \`${tName}\` ${timing.toUpperCase()} ${event.toUpperCase()} ON \`${tblName}\` FOR EACH ROW ${body}`,
      }

      // Attach to owning table
      const table = (s.tables ?? []).find((t) => t.name === tblName)
      if (table) {
        if (!table.triggers) table.triggers = []
        table.triggers.push(trigger)
      }
    }
  }

  // -- Inspect functions and procedures --

  protected async inspectFuncs(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    // Query routines
    const query = routinesQuery.replace('%s', nArgs(schemaNames.length))
    const args: unknown[] = schemaNames
    const result = await this.db.query(query, args)

    interface RoutineInfo {
      schema: Schema
      rtype: string
      body: string
      lang: string
      retType: string
    }

    const order: string[] = []
    const routines = new Map<string, RoutineInfo>()

    for (const row of result.rows) {
      const sName = row.ROUTINE_SCHEMA as string
      const name = row.ROUTINE_NAME as string
      const rtype = row.ROUTINE_TYPE as string
      const body = (row.ROUTINE_DEFINITION as string) || ''
      const lang = (row.EXTERNAL_LANGUAGE as string) || ''
      const retType = (row.DTD_IDENTIFIER as string) || ''

      const s = schemaMap.get(sName)
      if (!s) continue

      const key = `${sName}\x00${name}\x00${rtype}`
      if (!routines.has(key)) {
        order.push(key)
      }
      routines.set(key, { schema: s, rtype, body, lang, retType })
    }

    // Query parameters
    const paramsQuery = parametersQuery.replace('%s', nArgs(schemaNames.length))
    const paramsResult = await this.db.query(paramsQuery, args)
    const params = new Map<string, FuncArg[]>()

    for (const row of paramsResult.rows) {
      const sName = row.SPECIFIC_SCHEMA as string
      const rName = row.SPECIFIC_NAME as string
      const mode = (row.PARAMETER_MODE as string) || 'IN'
      const pName = (row.PARAMETER_NAME as string) || ''
      const typ = (row.DTD_IDENTIFIER as string) || ''

      const key = `${sName}\x00${rName}`
      if (!params.has(key)) params.set(key, [])

      let parsedType
      try {
        parsedType = parseType(typ)
      } catch {
        parsedType = { kind: 'unsupported' as const, T: typ }
      }

      const arg: FuncArg = {
        name: pName || undefined,
        type: { type: parsedType },
        mode: mode.toUpperCase(),
      }
      params.get(key)!.push(arg)
    }

    // Build funcs and procs
    for (const key of order) {
      const info = routines.get(key)!
      const [sName, name, rtype] = key.split('\x00')
      const funcArgs = params.get(`${sName}\x00${name}`) ?? []

      if (rtype === 'FUNCTION') {
        const f: Func = {
          name,
          body: info.body,
          lang: info.lang || undefined,
          args: funcArgs.length > 0 ? funcArgs : undefined,
        }
        if (info.retType) {
          try {
            f.ret = { type: parseType(info.retType) }
          } catch {
            f.ret = { type: { kind: 'unsupported', T: info.retType } }
          }
        }
        if (!info.schema.funcs) info.schema.funcs = []
        info.schema.funcs.push(f)
      } else if (rtype === 'PROCEDURE') {
        const p: Proc = {
          name,
          body: info.body,
          lang: info.lang || undefined,
          args: funcArgs.length > 0 ? funcArgs : undefined,
        }
        if (!info.schema.procs) info.schema.procs = []
        info.schema.procs.push(p)
      }
    }
  }

  // -- Current Schema --

  async currentSchema(): Promise<string> {
    const result = await this.db.query('SELECT DATABASE() AS s', [])
    const schema = (result.rows[0] as any)?.s
    if (!schema) throw new Error('failed to detect current schema from database connection')
    return schema
  }
}

// -- Internal Helpers --

function isHex(x: string): boolean {
  return x.length > 2 && x.slice(0, 2).toLowerCase() === '0x'
}

/** Quote a default value string (matches Go strconv.Quote — double-quote wrapping). */
function quoteDefault(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s
  }
  return JSON.stringify(s)
}
