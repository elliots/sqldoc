/** MSSQL schema inspector. Queries sys.* catalog views to build a Realm description. */

import { linkForeignKeys, validString } from '../internal/sqlx.ts'
import type { ExecQuerier, InspectOptions, Inspector, InspectRealmOption } from '../schema/inspect.ts'
import { InspectMode, NotExistError } from '../schema/inspect.ts'
import type {
  Attr,
  Check,
  Column,
  ColumnType,
  ForeignKey,
  Func,
  FuncArg,
  Index,
  IndexPart,
  Proc,
  Realm,
  Schema,
  Sequence,
  Table,
  Trigger,
  View,
} from '../schema/schema.ts'
import {
  checksQuery,
  columnsQuery,
  foreignKeysQuery,
  formatTypeSpec,
  funcsQuery,
  indexesQuery,
  MSSQL2012,
  nArgs,
  paramsQuery,
  parseReferenceAction,
  parseType,
  schemasQuery,
  schemasQueryArgs,
  sequencesQuery,
  tablesQuery,
  triggersQuery,
  viewsQuery,
} from './driver.ts'

// -- MSSQL Version --

export interface MssqlVersion {
  version: string
  major: number
  minor: number
  build: number
}

// -- MSSQL-specific Attribute Types --

/** Identity attribute for columns with IDENTITY property. */
export interface IdentityAttr {
  kind: 'identity'
  seed: number
  increment: number
}

/** Clustered attribute for indexes. */
export interface ClusteredAttr {
  kind: 'clustered'
  V: boolean
}

/** Include columns attribute for indexes with INCLUDE clause. */
export interface IncludeAttr {
  kind: 'include'
  columns: string[]
}

/** Filter predicate attribute for filtered indexes. */
export interface FilterAttr {
  kind: 'filter'
  expr: string
}

// -- MSSQL Inspector --

/**
 * MssqlInspector inspects SQL Server databases using sys.* catalog views.
 * Queries sys.schemas, sys.tables, sys.columns, sys.indexes, sys.foreign_keys,
 * sys.check_constraints, sys.views, sys.triggers, sys.objects, sys.parameters,
 * and sys.sequences to produce a complete Realm description.
 */
export class MssqlInspector implements Inspector {
  protected db: ExecQuerier
  protected v: MssqlVersion

  private versionProvided: boolean

  constructor(db: ExecQuerier, version?: string) {
    this.db = db
    this.versionProvided = !!version
    this.v = version ? parseMssqlVersion(version) : { version: '16.0.0', major: 16, minor: 0, build: 0 }
  }

  // -- Public Interface --

  async inspectSchema(name: string, opts?: InspectOptions): Promise<Schema> {
    await this.detectVersion()
    const schemas = await this.querySchemas({ schemas: [name] })
    if (schemas.length === 0) {
      throw new NotExistError(`mssql: schema "${name}" was not found`)
    }
    if (schemas.length > 1) {
      throw new Error(`mssql: ${schemas.length} schemas were found for "${name}"`)
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
    if (mode & InspectMode.InspectObjects) {
      await this.inspectSequences(realm)
    }

    return schemas[0]
  }

  async inspectRealm(opts?: InspectRealmOption): Promise<Realm> {
    await this.detectVersion()

    const schemas = await this.querySchemas(opts)
    const mode = opts?.mode ?? InspectMode.InspectAll
    const realm: Realm = { schemas }

    if (schemas.length === 0) return realm

    if (mode & InspectMode.InspectTables) {
      await this.inspectTables(realm)
      linkForeignKeys(realm)
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
    if (mode & InspectMode.InspectObjects) {
      await this.inspectSequences(realm)
    }

    realm.defaultSchema = await this.currentSchema()
    return realm
  }

  // -- Version Detection --

  protected async detectVersion(): Promise<void> {
    if (this.versionProvided) return
    if (this.v.major > 0 && this.v.version !== '16.0.0') return
    try {
      const result = await this.db.query("SELECT SERVERPROPERTY('ProductVersion') AS version")
      if (result.rows.length > 0) {
        const verStr = result.rows[0].version as string
        if (verStr) {
          this.v = parseMssqlVersion(verStr)
        }
      }
    } catch {
      // Use default version if detection fails
    }
    // Require SQL Server 2016+ (version 13.x)
    if (this.v.major < 13) {
      throw new Error(`SQL Server ${this.v.version} is not supported. Minimum required version is 2016 (13.x).`)
    }
  }

  // -- Query Schemas --

  protected async querySchemas(opts?: InspectRealmOption): Promise<Schema[]> {
    let query = schemasQuery
    const args: unknown[] = []

    if (opts?.schemas && opts.schemas.length > 0) {
      if (opts.schemas.length === 1 && opts.schemas[0] === '') {
        query = schemasQueryArgs.replace('%s', '= SCHEMA_NAME()')
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
      const name = row.name as string
      if (!name) continue
      // MSSQL schemas don't have charset/collation at schema level
      schemas.push({ name })
    }
    return schemas
  }

  // -- Inspect Tables --

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
    const args: unknown[] = [...schemaNames]

    let query = tablesQuery.replace('%s', nArgs(schemaNames.length))

    if (opts?.tables && opts.tables.length > 0) {
      query += ` AND t.name IN (${nArgs(opts.tables.length)})`
      args.push(...opts.tables)
    }

    const result = await this.db.query(query, args)
    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const tSchema = row.schema_name as string
      const tName = row.table_name as string

      const s = schemaMap.get(tSchema)
      if (!s) continue

      const t: Table = { name: tName, schema: tSchema, columns: [] }
      const attrs: Attr[] = []

      const comment = row.table_comment as string | null
      if (comment && validString(comment)) {
        attrs.push({ kind: 'comment' as const, text: comment })
      }

      if (attrs.length > 0) t.attrs = attrs
      if (!s.tables) s.tables = []
      s.tables.push(t)
    }
  }

  // -- Inspect Columns --

  protected async queryColumns(s: Schema): Promise<void> {
    const tables = s.tables ?? []
    if (tables.length === 0) return
    const tableNames = tables.map((t) => t.name)

    const query = columnsQuery.replace('%s', nArgs(tableNames.length))
    const args: unknown[] = [s.name, ...tableNames]

    const result = await this.db.query(query, args)
    const tableMap = new Map(tables.map((t) => [t.name, t]))

    for (const row of result.rows) {
      const tableName = row.table_name as string
      const t = tableMap.get(tableName)
      if (!t) continue

      const name = row.column_name as string
      const typeName = row.type_name as string
      const maxLength = row.max_length as number
      const precision = row.precision as number
      const scale = row.scale as number
      const isNullable = row.is_nullable as boolean | number
      const isIdentity = row.is_identity as boolean | number
      const isComputed = row.is_computed as boolean | number
      const defaultDef = row.default_def as string | null
      const computedDef = row.computed_def as string | null
      const isPersisted = row.is_persisted as boolean | number | null
      const columnComment = row.column_comment as string | null
      const seedValue = row.seed_value as number | null
      const incrementValue = row.increment_value as number | null
      const collationName = row.collation_name as string | null

      // Build type spec
      const schemaType = parseType(typeName, maxLength, precision, scale)
      const raw = formatTypeSpec(typeName, maxLength, precision, scale)
      const ct: ColumnType = { type: schemaType, raw }
      if (toBool(isNullable)) ct.null = true

      const col: Column = { name, type: ct }
      const attrs: Attr[] = []

      // Default value
      if (defaultDef && validString(defaultDef) && !toBool(isComputed)) {
        col.default = parseMssqlDefault(defaultDef)
      }

      // Identity column
      if (toBool(isIdentity)) {
        attrs.push({
          kind: 'identity',
          seed: seedValue ?? 1,
          increment: incrementValue ?? 1,
        } as unknown as Attr)
      }

      // Computed column
      if (toBool(isComputed) && computedDef && validString(computedDef)) {
        attrs.push({
          kind: 'generated' as const,
          expr: stripOuterParens(computedDef),
          type: toBool(isPersisted) ? 'PERSISTED' : undefined,
        })
      }

      // Comment
      if (columnComment && validString(columnComment)) {
        attrs.push({ kind: 'comment' as const, text: columnComment })
      }

      // Collation (only meaningful for character types)
      if (collationName && validString(collationName) && isCharType(typeName)) {
        attrs.push({ kind: 'collation' as const, V: collationName })
      }

      if (attrs.length > 0) col.attrs = attrs
      t.columns.push(col)
    }
  }

  // -- Inspect Indexes --

  protected async queryIndexes(s: Schema): Promise<void> {
    const tables = s.tables ?? []
    if (tables.length === 0) return
    const tableNames = tables.map((t) => t.name)

    const query = indexesQuery.replace('%s', nArgs(tableNames.length))
    const args: unknown[] = [s.name, ...tableNames]

    const result = await this.db.query(query, args)
    const _tableMap = new Map(tables.map((t) => [t.name, t]))

    // Group rows by table + index name to handle multi-column indexes and included columns
    interface IndexRow {
      tableName: string
      indexName: string
      columnName: string
      isPrimaryKey: boolean
      isUnique: boolean
      isUniqueConstraint: boolean
      isClustered: boolean
      isDescending: boolean
      isSystemNamed: boolean
      isIncluded: boolean
      filterDef: string | null
    }

    const rows: IndexRow[] = []
    for (const row of result.rows) {
      rows.push({
        tableName: row.table_name as string,
        indexName: row.index_name as string,
        columnName: row.column_name as string,
        isPrimaryKey: toBool(row.is_primary_key),
        isUnique: toBool(row.is_unique),
        isUniqueConstraint: toBool(row.is_unique_constraint),
        isClustered: (row.index_type as number) === 1,
        isDescending: toBool(row.is_descending_key),
        isIncluded: toBool(row.is_included_column),
        isSystemNamed: toBool(row.is_system_named),
        filterDef: row.filter_definition as string | null,
      })
    }

    // Process each table's indexes
    for (const t of tables) {
      const tableRows = rows.filter((r) => r.tableName === t.name)
      if (tableRows.length === 0) continue

      // Group by index name
      const indexGroups = new Map<string, IndexRow[]>()
      for (const r of tableRows) {
        if (!indexGroups.has(r.indexName)) indexGroups.set(r.indexName, [])
        indexGroups.get(r.indexName)!.push(r)
      }

      for (const [indexName, indexRows] of indexGroups) {
        const first = indexRows[0]

        // Separate key columns from included columns
        const keyRows = indexRows.filter((r) => !r.isIncluded)
        const includeRows = indexRows.filter((r) => r.isIncluded)

        const parts: IndexPart[] = keyRows.map((r) => {
          const part: IndexPart = { column: r.columnName }
          if (r.isDescending) part.desc = true
          return part
        })

        const idxAttrs: Attr[] = []

        // Clustered attribute
        idxAttrs.push({ kind: 'clustered', V: first.isClustered } as unknown as Attr)

        // System-named: constraint name was auto-generated by MSSQL
        if (first.isSystemNamed) {
          idxAttrs.push({ kind: 'system_named', V: true } as unknown as Attr)
        }

        // Included columns
        if (includeRows.length > 0) {
          idxAttrs.push({
            kind: 'include',
            columns: includeRows.map((r) => r.columnName),
          } as unknown as Attr)
        }

        // Filter predicate
        if (first.filterDef && validString(first.filterDef)) {
          idxAttrs.push({ kind: 'filter', expr: first.filterDef } as unknown as Attr)
        }

        // Primary key
        if (first.isPrimaryKey) {
          t.primaryKey = {
            name: indexName,
            parts,
            attrs: idxAttrs.length > 0 ? idxAttrs : undefined,
          }
          continue
        }

        // Regular or unique index
        const idx: Index = {
          name: indexName,
          unique: first.isUnique || first.isUniqueConstraint || undefined,
          parts,
          attrs: idxAttrs.length > 0 ? idxAttrs : undefined,
        }

        if (!t.indexes) t.indexes = []
        t.indexes.push(idx)
      }
    }
  }

  // -- Inspect Foreign Keys --

  protected async queryForeignKeys(s: Schema): Promise<void> {
    const tables = s.tables ?? []
    if (tables.length === 0) return
    const tableNames = tables.map((t) => t.name)

    const query = foreignKeysQuery.replace('%s', nArgs(tableNames.length))
    const args: unknown[] = [s.name, ...tableNames]

    const result = await this.db.query(query, args)
    const tableMap = new Map(tables.map((t) => [t.name, t]))

    // Group FK columns by constraint name + parent table
    const fkMap = new Map<
      string,
      {
        table: Table
        symbol: string
        columns: string[]
        refTable: string
        refSchema: string
        refColumns: string[]
        onUpdate: string
        onDelete: string
      }
    >()
    const fkOrder: string[] = []

    for (const row of result.rows) {
      const fkName = row.fk_name as string
      const tableName = row.table_name as string
      const columnName = row.column_name as string
      const refTableName = row.ref_table as string
      const refSchemaName = row.ref_schema as string
      const refColumnName = row.ref_column as string
      const onUpdate = row.update_referential_action_desc as string
      const onDelete = row.delete_referential_action_desc as string

      const key = `${tableName}\x00${fkName}`
      let fk = fkMap.get(key)
      if (!fk) {
        const t = tableMap.get(tableName)
        if (!t) continue
        fk = {
          table: t,
          symbol: fkName,
          columns: [],
          refTable: refTableName,
          refSchema: refSchemaName,
          refColumns: [],
          onUpdate,
          onDelete,
        }
        fkMap.set(key, fk)
        fkOrder.push(key)
      }
      fk.columns.push(columnName)
      fk.refColumns.push(refColumnName)
    }

    for (const key of fkOrder) {
      const fk = fkMap.get(key)!
      if (!fk.table.foreignKeys) fk.table.foreignKeys = []

      const parsed: ForeignKey = {
        symbol: fk.symbol,
        columns: fk.columns,
        refTable: fk.refTable,
        refColumns: fk.refColumns,
        onUpdate: parseReferenceAction(fk.onUpdate),
        onDelete: parseReferenceAction(fk.onDelete),
      }

      // Always set refSchema
      if (fk.refSchema) {
        parsed.refSchema = fk.refSchema
      }

      fk.table.foreignKeys.push(parsed)
    }
  }

  // -- Inspect Check Constraints --

  protected async queryChecks(s: Schema): Promise<void> {
    const tables = s.tables ?? []
    if (tables.length === 0) return
    const tableNames = tables.map((t) => t.name)

    const query = checksQuery.replace('%s', nArgs(tableNames.length))
    const args: unknown[] = [s.name, ...tableNames]

    const result = await this.db.query(query, args)
    const tableMap = new Map(tables.map((t) => [t.name, t]))

    for (const row of result.rows) {
      const tableName = row.table_name as string
      const checkName = row.check_name as string
      const definition = row.definition as string

      const t = tableMap.get(tableName)
      if (!t) continue

      // MSSQL wraps check constraint definitions in outer parens
      const check: Check = {
        name: checkName,
        expr: stripOuterParens(definition),
      }

      if (!t.checks) t.checks = []
      t.checks.push(check)
    }
  }

  // -- Inspect Views --

  protected async inspectViews(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const query = viewsQuery.replace('%s', nArgs(schemaNames.length))
    const args: unknown[] = schemaNames
    const result = await this.db.query(query, args)
    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const sName = row.schema_name as string
      const vName = row.view_name as string
      const def = row.definition as string | null
      const comment = row.view_comment as string | null
      const isSchemaBound = row.is_schema_bound as boolean | number | null

      const s = schemaMap.get(sName)
      if (!s) continue

      const v: View = { name: vName, schema: sName }

      // Extract the SELECT body from the view definition
      if (def && validString(def)) {
        v.def = extractViewBody(def)
      }

      // Query view columns
      const viewCols = await this.queryViewColumns(sName, vName)
      if (viewCols.length > 0) {
        v.columns = viewCols
      }

      const viewAttrs: Attr[] = []
      if (comment && validString(comment)) {
        viewAttrs.push({ kind: 'comment' as const, text: comment })
      }
      if (toBool(isSchemaBound)) {
        viewAttrs.push({ kind: 'schema_bound', V: true } as unknown as Attr)
      }
      if (viewAttrs.length > 0) v.attrs = viewAttrs

      if (!s.views) s.views = []
      s.views.push(v)
    }
  }

  /** Query columns for a specific view. */
  protected async queryViewColumns(schemaName: string, viewName: string): Promise<Column[]> {
    const query = `
SELECT
  c.name AS column_name,
  tp.name AS type_name,
  c.max_length,
  c.precision,
  c.scale,
  c.is_nullable,
  c.collation_name
FROM sys.columns c
JOIN sys.views v ON c.object_id = v.object_id
JOIN sys.schemas s ON v.schema_id = s.schema_id
JOIN sys.types tp ON c.user_type_id = tp.user_type_id
WHERE s.name = ? AND v.name = ?
ORDER BY c.column_id`
    const result = await this.db.query(query, [schemaName, viewName])
    const columns: Column[] = []

    for (const row of result.rows) {
      const colName = row.column_name as string
      const typeName = row.type_name as string
      const maxLength = row.max_length as number
      const precision = row.precision as number
      const scale = row.scale as number
      const isNullable = row.is_nullable as boolean | number
      const collationName = row.collation_name as string | null

      const schemaType = parseType(typeName, maxLength, precision, scale)
      const raw = formatTypeSpec(typeName, maxLength, precision, scale)
      const ct: ColumnType = { type: schemaType, raw }
      if (toBool(isNullable)) ct.null = true

      const col: Column = { name: colName, type: ct }
      const attrs: Attr[] = []

      if (collationName && validString(collationName) && isCharType(typeName)) {
        attrs.push({ kind: 'collation' as const, V: collationName })
      }

      if (attrs.length > 0) col.attrs = attrs
      columns.push(col)
    }

    return columns
  }

  // -- Inspect Triggers --

  protected async inspectTriggers(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const query = triggersQuery.replace('%s', nArgs(schemaNames.length))
    const args: unknown[] = schemaNames
    const result = await this.db.query(query, args)
    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    // Group trigger events — a single MSSQL trigger can fire on multiple events
    interface TriggerInfo {
      schema: Schema
      name: string
      tableName: string
      timing: string
      events: string[]
      body: string
      isDisabled: boolean
    }

    const triggerMap = new Map<string, TriggerInfo>()
    const triggerOrder: string[] = []

    for (const row of result.rows) {
      const sName = row.schema_name as string
      const tName = row.trigger_name as string
      const tableName = row.table_name as string
      const _isAfter = row.is_after as boolean | number | null
      const isInsteadOf = row.is_instead_of as boolean | number | null
      const timing = toBool(isInsteadOf) ? 'INSTEAD OF' : 'AFTER'
      const event = row.event_type as string
      const body = row.body as string | null
      const isDisabled = row.is_disabled as boolean | number | null

      const s = schemaMap.get(sName)
      if (!s) continue

      const key = `${sName}\x00${tName}`
      let info = triggerMap.get(key)
      if (!info) {
        info = {
          schema: s,
          name: tName,
          tableName,
          timing: timing.toUpperCase(),
          events: [],
          body: body ?? '',
          isDisabled: toBool(isDisabled),
        }
        triggerMap.set(key, info)
        triggerOrder.push(key)
      }
      info.events.push(event.toUpperCase())
    }

    for (const key of triggerOrder) {
      const info = triggerMap.get(key)!

      const trigger: Trigger = {
        name: info.name,
        table: info.tableName,
        timing: info.timing,
        events: info.events,
        body: info.body || undefined,
      }

      const trigAttrs: Attr[] = []
      if (info.isDisabled) {
        trigAttrs.push({ kind: 'disabled', V: true } as unknown as Attr)
      }
      if (trigAttrs.length > 0) trigger.attrs = trigAttrs

      // Attach to owning table
      const table = (info.schema.tables ?? []).find((t) => t.name === info.tableName)
      if (table) {
        if (!table.triggers) table.triggers = []
        table.triggers.push(trigger)
      }
    }
  }

  // -- Inspect Functions and Procedures --

  protected async inspectFuncs(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    // Query functions and procedures
    const query = funcsQuery.replace('%s', nArgs(schemaNames.length))
    const args: unknown[] = schemaNames
    const result = await this.db.query(query, args)

    interface RoutineInfo {
      schema: Schema
      name: string
      objType: string
      body: string
      retType: string | null
    }

    const routines = new Map<string, RoutineInfo>()
    const routineOrder: string[] = []

    for (const row of result.rows) {
      const sName = row.schema_name as string
      const name = row.routine_name as string
      const objType = row.routine_type as string
      const body = (row.body as string) || ''
      const retTypeName = row.return_type as string | null

      const s = schemaMap.get(sName)
      if (!s) continue

      let retType: string | null = null
      if (retTypeName && validString(retTypeName)) {
        retType = retTypeName
      }

      const key = `${sName}\x00${name}\x00${objType}`
      if (!routines.has(key)) {
        routineOrder.push(key)
      }
      routines.set(key, { schema: s, name, objType, body, retType })
    }

    // Query parameters
    const pQuery = paramsQuery.replace('%s', nArgs(schemaNames.length))
    const paramsResult = await this.db.query(pQuery, args)
    const params = new Map<string, FuncArg[]>()

    for (const row of paramsResult.rows) {
      const sName = row.schema_name as string
      const objName = row.routine_name as string
      const paramName = row.param_name as string | null
      const typeName = row.type_name as string
      const maxLength = row.max_length as number
      const precision = row.precision as number
      const scale = row.scale as number
      const isOutput = row.is_output as boolean | number

      const schemaType = parseType(typeName, maxLength, precision, scale)
      const raw = formatTypeSpec(typeName, maxLength, precision, scale)

      const arg: FuncArg = {
        name: paramName && validString(paramName) ? stripAtPrefix(paramName) : undefined,
        type: { type: schemaType, raw },
        mode: toBool(isOutput) ? 'OUT' : 'IN',
      }

      const key = `${sName}\x00${objName}`
      if (!params.has(key)) params.set(key, [])
      params.get(key)!.push(arg)
    }

    // Build funcs and procs
    for (const key of routineOrder) {
      const info = routines.get(key)!
      const [sName, name, _objType] = key.split('\x00')
      const funcArgs = params.get(`${sName}\x00${name}`) ?? []

      // FN = scalar function, IF = inline table-valued, TF = table-valued
      if (info.objType.trim() === 'FN' || info.objType.trim() === 'IF' || info.objType.trim() === 'TF') {
        const f: Func = {
          name,
          schema: sName,
          body: info.body || undefined,
          args: funcArgs.length > 0 ? funcArgs : undefined,
        }
        if (info.retType) {
          const retSchemaType = parseType(info.retType, 0, 0, 0)
          f.ret = { type: retSchemaType, raw: info.retType }
        }
        // Tag table-valued functions
        const funcAttrs: Attr[] = []
        if (info.objType.trim() === 'IF') {
          funcAttrs.push({ kind: 'func_type', V: 'inline_table' } as unknown as Attr)
        } else if (info.objType.trim() === 'TF') {
          funcAttrs.push({ kind: 'func_type', V: 'table' } as unknown as Attr)
        }
        if (funcAttrs.length > 0) f.attrs = funcAttrs

        if (!info.schema.funcs) info.schema.funcs = []
        info.schema.funcs.push(f)
      } else if (info.objType.trim() === 'P') {
        // Stored procedure
        const p: Proc = {
          name,
          schema: sName,
          body: info.body || undefined,
          args: funcArgs.length > 0 ? funcArgs : undefined,
        }
        if (!info.schema.procs) info.schema.procs = []
        info.schema.procs.push(p)
      }
    }
  }

  // -- Inspect Sequences --

  protected async inspectSequences(realm: Realm): Promise<void> {
    // Sequences require SQL Server 2012+
    if (this.v.major < MSSQL2012) return

    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const query = sequencesQuery.replace('%s', nArgs(schemaNames.length))
    const args: unknown[] = schemaNames
    const result = await this.db.query(query, args)
    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const sName = row.schema_name as string
      const seqName = row.sequence_name as string
      const typeName = row.type_name as string
      const startValue = row.start_value as number | bigint
      const incrementBy = row.increment as number | bigint
      const minValue = row.min_value as number | bigint
      const maxValue = row.max_value as number | bigint
      const isCycling = row.is_cycling as boolean | number
      const cacheSize = row.cache_size as number | bigint | null

      const s = schemaMap.get(sName)
      if (!s) continue

      const schemaType = parseType(typeName, 0, 0, 0)

      const seq: Sequence = {
        name: seqName,
        schema: sName,
        type: { type: schemaType, raw: typeName },
        start: toBigIntOrNumber(startValue),
        increment: toBigIntOrNumber(incrementBy),
        min: toBigIntOrNumber(minValue),
        max: toBigIntOrNumber(maxValue),
        cycle: toBool(isCycling) || undefined,
        cache: cacheSize != null ? toBigIntOrNumber(cacheSize) : undefined,
      }

      if (!s.sequences) s.sequences = []
      s.sequences.push(seq)
    }
  }

  // -- Current Schema --

  async currentSchema(): Promise<string> {
    return this.db.currentSchema
  }
}

// -- Internal Helpers --

/** Parse MSSQL version string (e.g. "16.0.1000") into components. */
function parseMssqlVersion(versionStr: string): MssqlVersion {
  const match = versionStr.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) {
    return { version: versionStr, major: 0, minor: 0, build: 0 }
  }
  return {
    version: versionStr,
    major: parseInt(match[1], 10),
    minor: match[2] ? parseInt(match[2], 10) : 0,
    build: match[3] ? parseInt(match[3], 10) : 0,
  }
}

/**
 * Parse MSSQL default value definition.
 * MSSQL wraps defaults in parentheses: ((0)) for numeric, (('text')) for strings,
 * (getdate()) for functions. Strip outer parens and classify as literal or expression.
 */
function parseMssqlDefault(def: string): { V: string } | { X: string } | undefined {
  if (!def || !validString(def)) return undefined

  let stripped = stripOuterParens(def)
  // MSSQL often double-wraps: ((value)) -> (value) -> value
  stripped = stripOuterParens(stripped)

  if (stripped === '') return undefined

  // String literal: starts and ends with single quotes
  if (stripped.startsWith("'") && stripped.endsWith("'")) {
    return { V: stripped }
  }

  // NULL literal
  if (stripped.toUpperCase() === 'NULL') {
    return undefined
  }

  // Numeric literal (integer or decimal)
  if (isNumericLiteral(stripped)) {
    return { V: stripped }
  }

  // Hex literal
  if (stripped.startsWith('0x') || stripped.startsWith('0X')) {
    return { V: stripped }
  }

  // Everything else is an expression (function call, NEWID(), getdate(), etc.)
  return { X: stripped }
}

/** Strip a single layer of outer parentheses from a string if present. */
function stripOuterParens(s: string): string {
  const trimmed = s.trim()
  if (trimmed.length >= 2 && trimmed[0] === '(' && trimmed[trimmed.length - 1] === ')') {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Check if a string is a numeric literal (integer or decimal, possibly negative). */
function isNumericLiteral(s: string): boolean {
  if (s === '' || s === '-' || s === '.') return false
  return /^-?\d+(\.\d+)?$/.test(s)
}

/** Check if a MSSQL type name is a character/string type that has collation. */
function isCharType(typeName: string): boolean {
  const lower = typeName.toLowerCase()
  return (
    lower === 'char' ||
    lower === 'varchar' ||
    lower === 'text' ||
    lower === 'nchar' ||
    lower === 'nvarchar' ||
    lower === 'ntext'
  )
}

/** Coerce a value to boolean. Handles boolean, number (0/1), and null. */
function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return false
}

/** Convert a value to bigint or number, preserving precision for large values. */
function toBigIntOrNumber(v: number | bigint | null | undefined): number | bigint | undefined {
  if (v == null) return undefined
  if (typeof v === 'bigint') return v
  return v
}

/** Strip the @ prefix from MSSQL parameter names. */
function stripAtPrefix(name: string): string {
  if (name.startsWith('@')) return name.slice(1)
  return name
}

/**
 * Extract the SELECT body from a CREATE VIEW ... AS <body> statement.
 * Returns the portion after the AS keyword.
 */
function extractViewBody(def: string): string {
  // The view definition from sys.sql_modules includes CREATE VIEW ... AS ...
  // We want just the SELECT portion after AS
  const upper = def.toUpperCase()
  const asIdx = findViewAsKeyword(upper)
  if (asIdx >= 0) {
    return def.slice(asIdx + 2).trim()
  }
  // If we can't find the AS keyword, return the full definition
  return def.trim()
}

/**
 * Find the AS keyword that separates the CREATE VIEW header from the body.
 * Handles cases like column lists in parentheses: CREATE VIEW v (a, b) AS SELECT ...
 * Returns the index of the 'A' in 'AS', or -1 if not found.
 */
function findViewAsKeyword(upper: string): number {
  let depth = 0
  for (let i = 0; i < upper.length - 1; i++) {
    if (upper[i] === '(') {
      depth++
    } else if (upper[i] === ')') {
      depth--
    } else if (depth === 0 && upper[i] === 'A' && upper[i + 1] === 'S') {
      // Verify AS is a word boundary (not part of a longer word)
      const before = i > 0 ? upper[i - 1] : ' '
      const after = i + 2 < upper.length ? upper[i + 2] : ' '
      if (/\s/.test(before) && (/\s/.test(after) || after === '\n')) {
        return i
      }
    }
  }
  return -1
}
