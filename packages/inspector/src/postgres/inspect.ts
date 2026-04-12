// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/postgres/inspect_oss.go

import type { DatabaseAdapter } from '../adapter.ts'
import {
  linkForeignKeys,
  modeInspectRealm,
  modeInspectSchema,
  scanBigInt,
  scanBool,
  scanNumber,
  scanString,
  validString,
} from '../internal/sqlx.ts'
import type { InspectOptions, Inspector, InspectRealmOption } from '../schema/inspect.ts'
import { InspectMode } from '../schema/inspect.ts'
import type {
  Check,
  Column,
  ColumnType,
  CompositeType,
  DomainType,
  EnumType,
  EventTrigger,
  Extension,
  ForeignKey,
  Func,
  FuncArg,
  Index,
  IndexPart,
  ObjectRef,
  Policy,
  Proc,
  Realm,
  ReferenceAction,
  Schema,
  SchemaType,
  Sequence,
  Table,
  Trigger,
  View,
} from '../schema/schema.ts'
import {
  aggregatesQuery,
  checksQuery,
  columnsQuery,
  compositesQuery,
  depsQuery,
  domainChecksQuery,
  domainsQuery,
  enumsQuery,
  eventTriggersQuery,
  extensionsQuery,
  fksQuery,
  funcsQuery,
  indexesQuery as indexesQueryForVersion,
  nArgs,
  parseFuncArgs,
  parseReferenceAction,
  parseType,
  parseVersion,
  policiesQuery,
  rangeTypesQuery,
  schemasQuery,
  schemasQueryArgs,
  sequencesQuery,
  stripOwnSchemaFromType,
  tablesQuery,
  tablesQueryArgs,
  triggersQuery,
  viewColumnsQuery,
  viewsQuery,
} from './driver.ts'

// -- PostgreSQL Inspector --

/**
 * PostgresInspector implements the Inspector interface for PostgreSQL databases.
 * It queries pg_catalog system tables to build a complete Realm description
 * covering tables, columns, indexes, foreign keys, checks, triggers, views,
 * functions, procedures, sequences, enums, composite types, domain types,
 * extensions, RLS policies, event triggers, and dependencies.
 */
export class PostgresInspector implements Inspector {
  private db: DatabaseAdapter
  private version = 0

  constructor(db: DatabaseAdapter) {
    this.db = db
  }

  // -- Public Interface --

  async inspectSchema(name: string, opts?: InspectOptions): Promise<Schema> {
    const schemas = await this.querySchemaNames(name ? [name] : undefined)
    if (schemas.length === 0) {
      if (name === '') {
        throw new Error('postgres: current_schema() defined in search_path was not found')
      }
      throw new Error(`postgres: schema "${name}" was not found`)
    }
    if (schemas.length > 1) {
      throw new Error(`postgres: ${schemas.length} schemas were found for "${name}"`)
    }

    const realm: Realm = { schemas }
    const mode = modeInspectSchema(opts)

    if (mode & InspectMode.InspectTypes) {
      await this.inspectEnums(realm)
      await this.inspectDomains(realm)
      await this.inspectCompositeTypes(realm)
    }
    if (mode & InspectMode.InspectTables) {
      await this.inspectTables(realm, opts)
    }
    if (mode & InspectMode.InspectViews) {
      await this.inspectViews(realm)
    }
    if (mode & InspectMode.InspectFuncs) {
      await this.inspectFunctions(realm)
    }
    if (mode & InspectMode.InspectObjects) {
      await this.inspectSequences(realm)
    }
    if (mode & InspectMode.InspectTriggers) {
      await this.inspectTriggers(realm)
      await this.inspectPolicies(realm)
    }
    await this.inspectDeps(realm)
    resolveColumnTypes(realm)

    return realm.schemas[0]
  }

  async inspectRealm(opts?: InspectRealmOption): Promise<Realm> {
    // Detect server version
    await this.detectVersion()

    // Clear search_path to ensure format_type returns schema-qualified names
    // (matches Go's noSearchPath). This ensures types like "hstore" are returned
    // as "public.hstore" and cross-schema types are fully qualified.
    const restoreSearchPath = await this.noSearchPath()

    try {
      const schemaNames = opts?.schemas
      const schemas = await this.querySchemaNames(schemaNames)
      const realm: Realm = { schemas }

      if (schemas.length === 0) return realm

      const mode = modeInspectRealm(opts)

      if (mode & InspectMode.InspectTypes) {
        await this.inspectEnums(realm)
        await this.inspectDomains(realm)
        await this.inspectCompositeTypes(realm)
      }
      if (mode & InspectMode.InspectTables) {
        await this.inspectTables(realm)
        linkForeignKeys(realm)
      }
      if (mode & InspectMode.InspectViews) {
        await this.inspectViews(realm)
      }
      if (mode & InspectMode.InspectFuncs) {
        await this.inspectFunctions(realm)
      }
      if (mode & InspectMode.InspectObjects) {
        await this.inspectSequences(realm)
        await this.inspectExtensions(realm)
        await this.inspectEventTriggers(realm)
        await this.inspectRangeTypes(realm)
        await this.inspectAggregates(realm)
      }
      if (mode & InspectMode.InspectTriggers) {
        await this.inspectTriggers(realm)
        await this.inspectPolicies(realm)
      }
      await this.inspectDeps(realm)
      resolveColumnTypes(realm)

      return realm
    } finally {
      await restoreSearchPath()
    }
  }

  // -- Version Detection --

  private async detectVersion(): Promise<void> {
    if (this.version > 0) return
    const result = await this.db.query("SELECT current_setting('server_version_num')")
    if (result.rows.length > 0) {
      const verStr = scanString(result.rows[0], 0)
      if (verStr) {
        this.version = parseVersion(verStr)
      }
    }
  }

  // -- Search Path Management (matches Go's noSearchPath) --

  /**
   * Clear the session search_path so that format_type returns schema-qualified names.
   * Returns a function to restore the original search_path.
   */
  private async noSearchPath(): Promise<() => Promise<void>> {
    try {
      const result = await this.db.query("SELECT current_setting('search_path'), set_config('search_path', '', false)")
      const prev = result.rows.length > 0 ? scanString(result.rows[0], 0) : null
      return async () => {
        if (prev != null) {
          await this.db.query('SELECT set_config($1, $2, false)', ['search_path', prev])
        }
      }
    } catch {
      // If search_path management fails (e.g. PGLite limitations), continue without it
      return async () => {}
    }
  }

  // -- Schema Discovery --

  private async querySchemaNames(names?: string[]): Promise<Schema[]> {
    let query: string
    let args: unknown[] = []

    if (!names || names.length === 0) {
      query = schemasQuery
    } else if (names.length === 1 && names[0] === '') {
      query = schemasQueryArgs.replace('%s', '= CURRENT_SCHEMA()')
    } else if (names.length === 1) {
      query = schemasQueryArgs.replace('%s', '= $1')
      args = [names[0]]
    } else {
      query = schemasQueryArgs.replace('%s', `IN (${nArgs(0, names.length)})`)
      args = [...names]
    }

    const result = await this.db.query(query, args)
    const schemas: Schema[] = []
    for (const row of result.rows) {
      const name = scanString(row, 0)
      const comment = scanString(row, 1)
      if (!name) continue
      const s: Schema = { name }
      if (comment) {
        s.attrs = [{ kind: 'comment', text: comment }]
      }
      schemas.push(s)
    }
    return schemas
  }

  // -- Table Inspection --

  private async inspectTables(realm: Realm, opts?: InspectOptions): Promise<void> {
    await this.queryTables(realm, opts)

    // Collect schemas with tables for batch querying
    const schemasWithTables = realm.schemas.filter((s) => s.tables && s.tables.length > 0)
    if (schemasWithTables.length === 0) return

    await this.queryColumns(schemasWithTables, realm)
    await this.queryIndexes(schemasWithTables)
    await this.queryChecks(schemasWithTables)
    await this.queryForeignKeys(schemasWithTables)
  }

  private async queryTables(realm: Realm, opts?: InspectOptions): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    const args: unknown[] = [...schemaNames]

    let query: string
    if (opts?.tables && opts.tables.length > 0) {
      args.push(...opts.tables)
      query = tablesQueryArgs
        .replace('%s', nArgs(0, schemaNames.length))
        .replace('%s', nArgs(schemaNames.length, opts.tables.length))
    } else {
      query = tablesQuery.replace('%s', nArgs(0, schemaNames.length))
    }

    const result = await this.db.query(query, args)
    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const tSchema = scanString(row, 1)
      const name = scanString(row, 2)
      const comment = scanString(row, 3)
      const rlsEnabled = scanBool(row, 8)
      const rlsForced = scanBool(row, 9)

      if (!tSchema || !name) continue

      const s = schemaMap.get(tSchema)
      if (!s) continue

      const table: Table = { name, schema: tSchema, columns: [] }
      if (comment) {
        table.attrs = [{ kind: 'comment', text: comment }]
      }

      // RLS attributes (stored as table-level attrs)
      if (rlsEnabled || rlsForced) {
        if (!table.attrs) table.attrs = []
        table.attrs.push({ kind: 'rls', enabled: rlsEnabled ?? false, forced: rlsForced ?? false } as any)
      }

      if (!s.tables) s.tables = []
      s.tables.push(table)
    }
  }

  private async queryColumns(schemas: Schema[], realm: Realm): Promise<void> {
    const { query, args } = this.buildSchemaTableQuery(columnsQuery, schemas)
    const result = await this.db.query(query, args)

    const schemaMap = new Map(schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const schemaName = scanString(row, 0)
      const tableName = scanString(row, 1)
      const colName = scanString(row, 2)
      const dataType = scanString(row, 3)
      const fmtype = scanString(row, 4)
      const nullable = scanString(row, 5)
      const defaultVal = scanString(row, 6)
      const maxLen = scanNumber(row, 7)
      const numPrecision = scanNumber(row, 8)
      const dtPrecision = scanNumber(row, 9)
      const numScale = scanNumber(row, 10)
      const identity = scanString(row, 14)
      const genIdentity = scanString(row, 18)
      const genExpr = scanString(row, 19)
      const comment = scanString(row, 20)
      const typtype = scanString(row, 21)

      if (!schemaName || !tableName || !colName) continue

      const s = schemaMap.get(schemaName)
      if (!s) continue

      const table = s.tables?.find((t) => t.name === tableName)
      if (!table) continue

      // Parse type — match Go's addColumn + columnType exactly.
      // Go creates columnDesc from DB metadata, then calls columnType(desc).
      // For typtype e/d, Go overrides to UserDefinedType{T: fmtype, C: typtype}.
      // For other types, Go uses columnType with DB metadata (precision, scale, size).
      let schemaType: SchemaType
      let rawType: string | undefined

      // Step 1: Build the base type using DB metadata (matches Go's columnType with columnDesc)
      const resolvedType = fmtype || dataType || ''
      schemaType = parseType(resolvedType)

      // Step 2: Apply DB column metadata that parseType can't know about
      // (Go passes these from information_schema.columns into columnDesc)
      applyColumnMetadata(schemaType, numPrecision, dtPrecision, maxLen, numScale)

      // Remove zero-value fields (match Go omitempty behavior)
      for (const key of ['size', 'precision', 'scale'] as const) {
        if ((schemaType as any)[key] === 0) {
          delete (schemaType as any)[key]
        }
      }

      // Step 3: Handle user-defined types (matches Go's typtype override + underlyingType)
      // Go: after columnType, if typtype is "d" or "e", override to UserDefinedType{T: fmtype, C: typtype}
      // Then resolve via underlyingType.
      if (typtype === 'e' || typtype === 'd') {
        const qualifiedName = fmtype || dataType || ''
        // Create UserDefinedType equivalent: {kind: 'unknown', T: fmtype, class: typtype}
        schemaType = { kind: 'unknown', T: qualifiedName, class: typtype } as any
        // underlyingType resolves against realm schemas
        const resolved = this.resolveUserDefinedType(s, qualifiedName, typtype, realm)
        if (resolved) {
          rawType = (schemaType as any).T
          schemaType = resolved
        } else {
          rawType = typtype === 'd' ? fmtype || undefined : dataType || fmtype || undefined
        }
      } else if (typtype === 'c') {
        // Composite type — resolve against known composites
        const qualifiedName = fmtype || dataType || ''
        const resolved = this.resolveUserDefinedType(s, qualifiedName, typtype, realm)
        if (resolved && resolved.kind === 'composite') {
          // Use compositeFields format for column output (matches Go marshal)
          schemaType = buildCompositeColumnType(resolved as CompositeType)
          rawType = qualifiedName
        } else if (resolved) {
          schemaType = resolved
          rawType = qualifiedName
        } else {
          schemaType = { kind: 'unknown', T: qualifiedName, class: typtype } as any
          rawType = dataType || fmtype || undefined
        }
      } else if (dataType === 'USER-DEFINED' || schemaType.kind === 'unsupported') {
        // Non-e/c/d user-defined types (range types, extension types like hstore, etc.)
        // Go: falls through to default case → UserDefinedType{T: fmtype, C: typtype}
        const ft = fmtype || dataType || ''
        schemaType = { kind: 'unknown', T: ft } as any
        if (typtype) (schemaType as any).class = typtype
        rawType = dataType || fmtype || undefined
      } else {
        // Standard type: raw = data_type (matches Go: Raw = typ.String)
        rawType = dataType || fmtype || undefined
      }

      // Step 4: Handle array inner type resolution (matches Go: ArrayType → underlyingType on inner)
      if (schemaType.kind === 'array') {
        const arr = schemaType as any
        if (arr.type?.kind === 'unsupported' || arr.type?.kind === 'unknown') {
          const innerResolved = this.resolveUserDefinedType(s, arr.type.T, '', realm)
          if (innerResolved) {
            // Composites need compositeFields format for column output
            arr.type =
              innerResolved.kind === 'composite'
                ? buildCompositeColumnType(innerResolved as CompositeType)
                : innerResolved
          }
        }
      }

      const colType: ColumnType = {
        type: schemaType,
        raw: rawType,
      }
      // Only set null if true (match Go omitempty)
      if (nullable === 'YES') {
        colType.null = true
      }

      const col: Column = { name: colName, type: colType }

      // Default value — classify as Literal (V) or RawExpr (X)
      if (defaultVal) {
        col.default = classifyDefault(defaultVal, schemaType)
      }

      // Identity column
      if (identity === 'YES' && genIdentity) {
        if (!col.attrs) col.attrs = []
        col.attrs.push({
          kind: 'identity',
          generation: genIdentity,
        } as any)
      }

      // Generated expression
      if (validString(genExpr)) {
        if (!col.attrs) col.attrs = []
        col.attrs.push({
          kind: 'generated',
          expr: genExpr,
        })
      }

      // Comment
      if (validString(comment)) {
        if (!col.attrs) col.attrs = []
        col.attrs.push({ kind: 'comment', text: comment })
      }

      table.columns.push(col)
    }
  }

  private async queryIndexes(schemas: Schema[]): Promise<void> {
    await this.detectVersion()
    const idxQuery = indexesQueryForVersion(this.version)
    const { query, args } = this.buildSchemaTableQuery(idxQuery, schemas)
    const result = await this.db.query(query, args)

    const schemaMap = new Map(schemas.map((s) => [s.name, s]))
    const indexMap = new Map<string, { index: Index; schemaName: string; tableName: string; isPrimary: boolean }>()

    for (const row of result.rows) {
      const schemaName = scanString(row, 0)
      const tableName = scanString(row, 1)
      const indexName = scanString(row, 2)
      const indexType = scanString(row, 3)
      const columnName = scanString(row, 4)
      const included = scanBool(row, 5)
      const isPrimary = scanBool(row, 6)
      const isUnique = scanBool(row, 7)
      const predicate = scanString(row, 10)
      const expression = scanString(row, 11)
      const isDesc = scanBool(row, 12)
      const comment = scanString(row, 15)

      if (!schemaName || !tableName || !indexName) continue

      const s = schemaMap.get(schemaName)
      if (!s) continue
      const table = s.tables?.find((t) => t.name === tableName)
      if (!table) continue

      const key = `${schemaName}.${indexName}`
      let entry = indexMap.get(key)
      if (!entry) {
        const idx: Index = {
          name: indexName,
          unique: isUnique || undefined,
          parts: [],
        }
        if (indexType) {
          if (!idx.attrs) idx.attrs = []
          idx.attrs.push({ kind: 'index_type', T: indexType } as any)
        }
        if (validString(comment)) {
          if (!idx.attrs) idx.attrs = []
          idx.attrs.push({ kind: 'comment', text: comment })
        }
        if (validString(predicate)) {
          if (!idx.attrs) idx.attrs = []
          idx.attrs.push({ kind: 'predicate', P: predicate } as any)
        }
        entry = { index: idx, schemaName, tableName, isPrimary: isPrimary ?? false }
        indexMap.set(key, entry)

        if (isPrimary) {
          table.primaryKey = idx
        } else {
          if (!table.indexes) table.indexes = []
          table.indexes.push(idx)
        }
      }

      // Skip INCLUDE columns from index parts
      if (included) continue

      const part: IndexPart = {}
      if (validString(columnName)) {
        part.column = columnName
      } else if (validString(expression)) {
        part.expr = expression
      }
      if (isDesc) part.desc = true
      entry.index.parts.push(part)
    }
  }

  private async queryChecks(schemas: Schema[]): Promise<void> {
    const { query, args } = this.buildSchemaTableQuery(checksQuery, schemas)
    const result = await this.db.query(query, args)

    const schemaMap = new Map(schemas.map((s) => [s.name, s]))
    const checkMap = new Map<string, Check>()

    for (const row of result.rows) {
      const schemaName = scanString(row, 0)
      const tableName = scanString(row, 1)
      const checkName = scanString(row, 2)
      const expression = scanString(row, 3)
      const noInherit = scanBool(row, 6)

      if (!schemaName || !tableName || !checkName || !expression) continue

      const s = schemaMap.get(schemaName)
      if (!s) continue
      const table = s.tables?.find((t) => t.name === tableName)
      if (!table) continue

      const key = `${schemaName}.${tableName}.${checkName}`
      if (!checkMap.has(key)) {
        const ck: Check = { name: checkName, expr: expression }
        if (noInherit) {
          ck.attrs = [{ kind: 'no_inherit' } as any]
        }
        checkMap.set(key, ck)
        if (!table.checks) table.checks = []
        table.checks.push(ck)
      }
    }
  }

  private async queryForeignKeys(schemas: Schema[]): Promise<void> {
    const { query, args } = this.buildSchemaTableQuery(fksQuery, schemas)
    const result = await this.db.query(query, args)

    const schemaMap = new Map(schemas.map((s) => [s.name, s]))
    // Group FK rows by constraint name
    const fkMap = new Map<string, { fk: ForeignKey; schemaName: string; tableName: string }>()

    for (const row of result.rows) {
      const constraintName = scanString(row, 0)
      const tableName = scanString(row, 1)
      const columnName = scanString(row, 2)
      const schemaName = scanString(row, 3)
      const refTableName = scanString(row, 4)
      const refColumnName = scanString(row, 5)
      const refSchemaName = scanString(row, 6)
      const updType = scanString(row, 7)
      const delType = scanString(row, 8)

      if (!constraintName || !tableName || !columnName || !schemaName || !refTableName || !refColumnName) continue

      const key = `${schemaName}.${tableName}.${constraintName}`
      let entry = fkMap.get(key)
      if (!entry) {
        const fk: ForeignKey = {
          symbol: constraintName,
          columns: [],
          refTable: refTableName,
          refColumns: [],
        }
        if (refSchemaName) {
          fk.refSchema = refSchemaName
        }
        if (updType) {
          const action = parseReferenceAction(updType)
          if (action) fk.onUpdate = action as ReferenceAction
        }
        if (delType) {
          const action = parseReferenceAction(delType)
          if (action) fk.onDelete = action as ReferenceAction
        }
        entry = { fk, schemaName, tableName }
        fkMap.set(key, entry)
      }

      entry.fk.columns.push(columnName)
      entry.fk.refColumns.push(refColumnName)
    }

    // Attach FKs to tables
    for (const { fk, schemaName, tableName } of fkMap.values()) {
      const s = schemaMap.get(schemaName)
      if (!s) continue
      const table = s.tables?.find((t) => t.name === tableName)
      if (!table) continue
      if (!table.foreignKeys) table.foreignKeys = []
      table.foreignKeys.push(fk)
    }
  }

  // -- View Inspection --

  private async inspectViews(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    const placeholders = schemaNames.map((_, i) => `$${i + 1}`).join(', ')
    const query = viewsQuery.replace('%s', placeholders)
    const result = await this.db.query(query, schemaNames)

    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const schemaName = scanString(row, 0)
      const viewName = scanString(row, 1)
      const def = scanString(row, 2)
      const isMaterialized = scanBool(row, 3)

      if (!schemaName || !viewName) continue

      const s = schemaMap.get(schemaName)
      if (!s) continue

      const view: View = {
        name: viewName,
        schema: schemaName,
        def: def || undefined,
        materialized: isMaterialized || undefined,
      }

      if (!s.views) s.views = []
      s.views.push(view)
    }

    // Inspect view columns
    const hasViews = realm.schemas.some((s) => s.views && s.views.length > 0)
    if (hasViews) {
      await this.inspectViewColumns(realm)
    }
  }

  private async inspectViewColumns(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    const placeholders = schemaNames.map((_, i) => `$${i + 1}`).join(', ')
    const query = viewColumnsQuery.replace('%s', placeholders)
    const result = await this.db.query(query, schemaNames)

    // Build view lookup
    const viewMap = new Map<string, View>()
    for (const s of realm.schemas) {
      for (const v of s.views ?? []) {
        viewMap.set(`${s.name}.${v.name}`, v)
      }
    }

    for (const row of result.rows) {
      const schemaName = scanString(row, 0)
      const viewName = scanString(row, 1)
      const colName = scanString(row, 2)
      const colType = scanString(row, 3)
      const isNullable = scanBool(row, 4)

      if (!schemaName || !viewName || !colName) continue

      const v = viewMap.get(`${schemaName}.${viewName}`)
      if (!v) continue

      const schemaType = parseType(colType || '')
      const col: Column = {
        name: colName === '?column?' ? '' : colName,
        type: {
          type: schemaType,
          null: isNullable ?? undefined,
        },
      }

      if (!v.columns) v.columns = []
      v.columns.push(col)
    }
  }

  // -- Function/Procedure Inspection --

  private async inspectFunctions(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    const placeholders = schemaNames.map((_, i) => `$${i + 1}`).join(', ')
    const query = funcsQuery.replace('%s', placeholders)
    const result = await this.db.query(query, schemaNames)

    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const schemaName = scanString(row, 0)
      const funcName = scanString(row, 1)
      const kind = scanString(row, 2)
      const def = scanString(row, 3)
      const lang = scanString(row, 4)
      const retType = scanString(row, 5)
      const funcArgsStr = scanString(row, 6)

      if (!schemaName || !funcName || !kind) continue

      // Skip internal functions
      if (lang === 'internal') continue

      const s = schemaMap.get(schemaName)
      if (!s) continue

      // Parse function arguments — matches Go's parseFuncArgs + ParseType
      // Go's ParseType wraps UnsupportedType → UserDefinedType, so all unknown types become 'unknown'.
      // Go does NOT alias 'character varying' → 'varchar' in func args (pg_get_function_arguments
      // returns canonical names, and Go preserves them as-is).
      const parsedArgs = parseFuncArgs(funcArgsStr || '')
      const args: FuncArg[] = parsedArgs.map((a) => {
        // Fix: parseFuncArgs in driver.ts falls through when parseType returns 'unsupported'
        // for pseudo-types like "record". Go's ParseType wraps UnsupportedType → UserDefinedType
        // so the name/type split works. We fix this by re-splitting args where the type T has
        // spaces and there's no name — the first token was the name.
        if (!a.name && a.type?.T?.includes(' ') && a.type?.kind === 'unsupported') {
          const tokens = a.type.T.split(/\s+/)
          if (tokens.length >= 2) {
            const typStr = tokens.slice(1).join(' ')
            const reParsed = parseType(typStr)
            // If re-parsing yields a known type or even unsupported (single token), use it
            a.name = tokens[0].replace(/"/g, '')
            a.type = reParsed
          }
        }
        // Match Go: ParseType wraps UnsupportedType in UserDefinedType (kind: 'unknown')
        if (a.type?.kind === 'unsupported') {
          ;(a.type as any).kind = 'unknown'
        }
        // Go uses format_type(oid, NULL) for func args which returns short aliases
        if (a.type) applyTimeAlias(a.type)
        const raw = a.type?.T || ''
        const arg: FuncArg = {
          name: a.name,
          type: { type: a.type, raw: raw || undefined },
          mode: a.mode,
        }
        // Add default, but skip NULL defaults (match Go behavior)
        if (a.default && !/^NULL$/i.test(a.default.replace(/::.*$/, ''))) {
          arg.default = classifyDefault(a.default, a.type)
        }
        return arg
      })

      if (kind === 'f') {
        // Normal function
        const f: Func = {
          name: funcName,
          schema: schemaName,
          body: def || undefined,
          lang: lang || undefined,
          args: args.length > 0 ? args : undefined,
        }

        // Parse return type — matches Go: stripOwnSchemaFromType, then ParseType
        if (retType) {
          const cleanRet = stripOwnSchemaFromType(retType, schemaName)
          const retSchemaType = parseType(cleanRet)
          // Match Go: ParseType wraps UnsupportedType in UserDefinedType (kind: 'unknown')
          if (retSchemaType.kind === 'unsupported') {
            ;(retSchemaType as any).kind = 'unknown'
          }
          // Also resolve array inner types (e.g. jwt_token[] → unknown inner)
          if (retSchemaType.kind === 'array') {
            const arr = retSchemaType as any
            if (arr.type?.kind === 'unsupported') {
              arr.type.kind = 'unknown'
            }
          }
          f.ret = { type: retSchemaType, raw: cleanRet }

          // Resolve SETOF <composite> — look up composite fields from realm
          if (retSchemaType.kind === 'unknown' && cleanRet.toLowerCase().startsWith('setof ')) {
            const innerName = cleanRet.slice(6).trim()
            const resolved = this.resolveUserDefinedType(s, innerName, '', realm)
            if (resolved && resolved.kind === 'composite') {
              f.ret.type = resolved
            }
          }
        }

        if (!s.funcs) s.funcs = []
        s.funcs.push(f)
      } else if (kind === 'p') {
        // Procedure
        const p: Proc = {
          name: funcName,
          schema: schemaName,
          body: def || undefined,
          lang: lang || undefined,
          args: args.length > 0 ? args : undefined,
        }

        if (!s.procs) s.procs = []
        s.procs.push(p)
      }
    }
  }

  // -- Enum Inspection --

  private async inspectEnums(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const query = enumsQuery.replace('%s', nArgs(0, schemaNames.length))
    const result = await this.db.query(query, schemaNames)

    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))
    const enumById = new Map<string, EnumType>()

    for (const row of result.rows) {
      const ns = scanString(row, 0)
      const enumId = scanString(row, 1)
      const enumName = scanString(row, 2)
      const enumValue = scanString(row, 3)

      if (!ns || !enumId || !enumName || enumValue == null) continue

      let e = enumById.get(enumId)
      if (!e) {
        e = { kind: 'enum', T: enumName, values: [], schema: ns }
        enumById.set(enumId, e)

        const s = schemaMap.get(ns)
        if (s) {
          if (!s.enums) s.enums = []
          s.enums.push(e)
        }
      }
      e.values.push(enumValue)
    }
  }

  // -- Domain Type Inspection --

  private async inspectDomains(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const query = domainsQuery.replace('%s', nArgs(0, schemaNames.length))
    const result = await this.db.query(query, schemaNames)

    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const ns = scanString(row, 0)
      const name = scanString(row, 1)
      const baseType = scanString(row, 2)
      const notNull = scanBool(row, 3)
      const dflt = scanString(row, 4)

      if (!ns || !name) continue

      const s = schemaMap.get(ns)
      if (!s) continue

      const typ = parseType(baseType || '')
      // Apply time alias to match Go's ParseType → parseColumn → timeAlias behavior
      applyTimeAlias(typ)
      const domain: DomainType = {
        kind: 'domain',
        T: name,
        type: typ,
        schema: ns,
      }
      // Only set null when true (match Go omitempty on bool)
      if (!notNull) {
        domain.null = true
      }
      if (dflt) {
        domain.default = { X: dflt }
      }

      // Store domain in attrs for later column type resolution
      if (!s.attrs) s.attrs = []
      s.attrs.push(domain as any)
    }

    // Inspect domain check constraints
    const chkQuery = domainChecksQuery.replace('%s', nArgs(0, schemaNames.length))
    const chkResult = await this.db.query(chkQuery, schemaNames)

    for (const row of chkResult.rows) {
      const ns = scanString(row, 0)
      const typName = scanString(row, 1)
      const conName = scanString(row, 2)
      const expr = scanString(row, 3)

      if (!ns || !typName || !conName || !expr) continue

      // Find the domain in attrs and add check
      const s = schemaMap.get(ns)
      if (!s) continue
      for (const attr of s.attrs ?? []) {
        if ((attr as any).kind === 'domain' && (attr as any).T === typName) {
          ;(attr as any).checks ??= []
          ;(attr as any).checks.push({ name: conName, expr })
          break
        }
      }
    }
  }

  // -- Composite Type Inspection --

  private async inspectCompositeTypes(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const query = compositesQuery.replace('%s', nArgs(0, schemaNames.length))
    const result = await this.db.query(query, schemaNames)

    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))
    const compositeMap = new Map<string, CompositeType>()

    for (const row of result.rows) {
      const ns = scanString(row, 0)
      const typName = scanString(row, 1)
      const fieldName = scanString(row, 2)
      const fieldType = scanString(row, 3)

      if (!ns || !typName || !fieldName) continue

      const key = `${ns}.${typName}`
      let ct = compositeMap.get(key)
      if (!ct) {
        ct = { kind: 'composite', T: typName, fields: [], schema: ns }
        compositeMap.set(key, ct)

        const s = schemaMap.get(ns)
        if (s) {
          if (!s.compositeTypes) s.compositeTypes = []
          s.compositeTypes.push(ct)
        }
      }

      const ft = parseType(fieldType || '')
      // Apply time alias to match Go's ParseType → parseColumn → timeAlias behavior
      applyTimeAlias(ft)
      ct.fields.push({ name: fieldName, type: ft })
    }
  }

  // -- Sequence Inspection --

  private async inspectSequences(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const query = sequencesQuery.replace('%s', nArgs(0, schemaNames.length))
    const result = await this.db.query(query, schemaNames)

    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const ns = scanString(row, 0)
      const name = scanString(row, 1)
      const seqType = scanString(row, 2)
      const start = scanBigInt(row, 3)
      const increment = scanBigInt(row, 4)
      const cache = scanBigInt(row, 5)
      const minV = scanBigInt(row, 6)
      const maxV = scanBigInt(row, 7)
      const cycle = scanBool(row, 8)
      const ownerTable = scanString(row, 9)
      const ownerColumn = scanString(row, 10)
      const depType = scanString(row, 11)

      if (!ns || !name) continue

      // Auto-owned sequences are managed by the column -- skip standalone emission
      if (ownerTable && ownerColumn) {
        if (depType === 'i') {
          // Identity columns: sequence is internal
          continue
        }
        // Serial columns: mark as serial on the owning column
        const s = schemaMap.get(ns)
        if (s) {
          this.convertToSerial(s, ownerTable, ownerColumn, name)
        }
        continue
      }

      const s = schemaMap.get(ns)
      if (!s) continue

      const seq: Sequence = {
        name,
        schema: ns,
        start: start ?? undefined,
        increment: increment ?? undefined,
        cache: cache ?? undefined,
        cycle: cycle ?? undefined,
      }

      if (seqType) {
        seq.type = { type: parseType(seqType) }
      }
      if (minV != null) seq.min = minV
      if (maxV != null) seq.max = maxV

      if (!s.sequences) s.sequences = []
      s.sequences.push(seq)
    }
  }

  /**
   * Resolve a user-defined type (enum/composite/domain) by searching schema objects.
   * Matches Go's underlyingType() — searches current schema, then cross-schema via qualified name.
   */
  private resolveUserDefinedType(
    currentSchema: Schema,
    qualifiedName: string,
    typtype: string,
    realm: Realm,
  ): SchemaType | undefined {
    // Parse "schema.name" or just "name"
    const dotIdx = qualifiedName.lastIndexOf('.')
    const ns = dotIdx >= 0 ? qualifiedName.slice(0, dotIdx) : ''
    const name = dotIdx >= 0 ? qualifiedName.slice(dotIdx + 1) : qualifiedName

    // Build search order (matches Go):
    // - If no namespace: search public schema first, then current schema
    // - If namespace: search that specific schema
    const searchSchemas: Schema[] = []
    if (ns === '') {
      const pub = realm.schemas.find((s) => s.name === 'public')
      if (pub && pub !== currentSchema) searchSchemas.push(pub)
      searchSchemas.push(currentSchema)
    } else {
      const target = realm.schemas.find((s) => s.name === ns)
      if (target) searchSchemas.push(target)
    }

    for (const s of searchSchemas) {
      // Search enums
      if (typtype === 'e' || typtype === '') {
        const e = s.enums?.find((e) => e.T === name)
        if (e) return e
      }
      // Search domains (stored in attrs)
      if (typtype === 'd' || typtype === '') {
        for (const a of (s.attrs ?? []) as any[]) {
          if (a?.kind === 'domain' && a.T === name) return a as DomainType
        }
      }
      // Search composites
      if (typtype === 'c' || typtype === '') {
        const ct = s.compositeTypes?.find((c) => c.T === name)
        if (ct) return ct
      }
    }
    return undefined
  }

  /** Convert a column with an auto-owned sequence to a serial type. */
  private convertToSerial(s: Schema, tableName: string, columnName: string, seqName: string): void {
    const table = s.tables?.find((t) => t.name === tableName)
    if (!table) return
    const col = table.columns.find((c) => c.name === columnName)
    if (!col) return

    // Determine the serial type based on the column's current integer type
    const currentType = col.type.type.T.toLowerCase()
    let serialType = 'serial'
    if (currentType === 'smallint' || currentType === 'int2') {
      serialType = 'smallserial'
    } else if (currentType === 'bigint' || currentType === 'int8') {
      serialType = 'bigserial'
    }

    col.type.type = { kind: 'serial', T: serialType, sequenceName: seqName } as any
    col.type.raw = serialType // raw should reflect the serial type, not the underlying integer
    col.default = undefined // Remove nextval() default since serial implies it
  }

  // -- Extension Inspection --

  private async inspectExtensions(realm: Realm): Promise<void> {
    const result = await this.db.query(extensionsQuery)

    for (const row of result.rows) {
      const name = scanString(row, 0)
      const ns = scanString(row, 1)
      const version = scanString(row, 2)

      if (!name) continue

      const ext: Extension = { name }
      if (ns) ext.schema = ns
      if (version) ext.version = version

      // Extensions are realm-level objects. Store on all schemas for now.
      // In the Go source they are stored on realm.Objects but we don't have that field.
      // Instead store on the matching schema or the first schema.
      const targetSchema = realm.schemas.find((s) => s.name === ns) ?? realm.schemas[0]
      if (targetSchema) {
        if (!targetSchema.extensions) targetSchema.extensions = []
        targetSchema.extensions.push(ext)
      }
    }
  }

  // -- Event Trigger Inspection --

  private async inspectEventTriggers(realm: Realm): Promise<void> {
    const result = await this.db.query(eventTriggersQuery)

    for (const row of result.rows) {
      const name = scanString(row, 0)
      const event = scanString(row, 1)
      const funcName = scanString(row, 2)
      const tags = scanString(row, 3)

      if (!name || !event) continue

      const et: EventTrigger = { name, event }
      if (funcName) et.function = funcName
      if (tags) et.tags = tags.split(',')

      // Event triggers are realm-level. Store on first schema.
      const targetSchema = realm.schemas[0]
      if (targetSchema) {
        if (!targetSchema.eventTriggers) targetSchema.eventTriggers = []
        targetSchema.eventTriggers.push(et)
      }
    }
  }

  // -- Range Type Inspection --

  private async inspectRangeTypes(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const query = rangeTypesQuery.replace('%s', nArgs(0, schemaNames.length))
    const result = await this.db.query(query, schemaNames)

    // Range types are stored as attrs on the schema for reference
    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))
    for (const row of result.rows) {
      const ns = scanString(row, 0)
      const typName = scanString(row, 1)
      const subtype = scanString(row, 2)

      if (!ns || !typName) continue

      const s = schemaMap.get(ns)
      if (!s) continue

      if (!s.attrs) s.attrs = []
      s.attrs.push({
        kind: 'range_type',
        T: typName,
        subtype: subtype || '',
        schema: ns,
      } as any)
    }
  }

  // -- Aggregate Inspection --

  private async inspectAggregates(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const query = aggregatesQuery.replace('%s', nArgs(0, schemaNames.length))
    const result = await this.db.query(query, schemaNames)

    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const ns = scanString(row, 0)
      const name = scanString(row, 1)
      const stateFunc = scanString(row, 2)
      const stateType = scanString(row, 3)
      const finalFunc = scanString(row, 4)
      const initVal = scanString(row, 5)
      const sortOp = scanString(row, 6)
      const parallel = scanString(row, 7)
      const argTypes = scanString(row, 8)

      if (!ns || !name) continue

      const s = schemaMap.get(ns)
      if (!s) continue

      const agg: any = {
        kind: 'aggregate',
        name,
        schema: ns,
        stateFunc: stateFunc || '',
        stateType: stateType || '',
      }
      if (finalFunc && finalFunc !== '-') agg.finalFunc = finalFunc
      if (initVal != null) agg.initVal = initVal
      if (sortOp && sortOp !== '0' && sortOp !== '') agg.sortOp = sortOp
      if (parallel && parallel !== '' && parallel !== 'UNSAFE') agg.parallel = parallel

      // Parse argument types
      if (argTypes) {
        agg.args = argTypes
          .split(',')
          .map((a: string) => a.trim())
          .filter(Boolean)
      }

      // Set dependencies on the state/final functions
      agg.deps = []
      for (const f of s.funcs ?? []) {
        const fname = f.name
        if (fname === stateFunc || `${ns}.${fname}` === stateFunc) {
          agg.deps.push({ type: 'func', name: fname, schema: ns })
        }
        if (finalFunc && (fname === finalFunc || `${ns}.${fname}` === finalFunc)) {
          agg.deps.push({ type: 'func', name: fname, schema: ns })
        }
      }

      if (!s.attrs) s.attrs = []
      s.attrs.push(agg)
    }
  }

  // -- Trigger Inspection --

  private async inspectTriggers(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const placeholders = schemaNames.map((_, i) => `$${i + 1}`).join(', ')
    const query = triggersQuery.replace('%s', placeholders)
    const result = await this.db.query(query, schemaNames)

    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const schemaName = scanString(row, 0)
      const trigName = scanString(row, 1)
      const tableName = scanString(row, 2)
      const actionTiming = scanString(row, 3)
      const eventManip = scanString(row, 4)
      const orientation = scanString(row, 5)
      const trigDef = scanString(row, 6)

      if (!schemaName || !trigName) continue

      const s = schemaMap.get(schemaName)
      if (!s) continue

      const trigger: Trigger = {
        name: trigName,
        body: trigDef || undefined,
      }

      // Timing
      switch (actionTiming?.toUpperCase()) {
        case 'BEFORE':
          trigger.timing = 'BEFORE'
          break
        case 'AFTER':
          trigger.timing = 'AFTER'
          break
        case 'INSTEAD OF':
          trigger.timing = 'INSTEAD OF'
          break
      }

      // Events
      if (eventManip) {
        trigger.events = eventManip
          .split(' OR ')
          .map((e) => e.trim().toUpperCase())
          .filter(Boolean)
      }

      // For each row/statement
      switch (orientation?.toUpperCase()) {
        case 'ROW':
          trigger.forEach = 'ROW'
          break
        case 'STATEMENT':
          trigger.forEach = 'STATEMENT'
          break
      }

      // Attach to table
      if (tableName) {
        trigger.table = tableName
        for (const tbl of s.tables ?? []) {
          if (tbl.name === tableName) {
            if (!tbl.triggers) tbl.triggers = []
            tbl.triggers.push(trigger)
            break
          }
        }
      }
    }
  }

  // -- RLS Policy Inspection --

  private async inspectPolicies(realm: Realm): Promise<void> {
    const schemaNames = realm.schemas.map((s) => s.name)
    if (schemaNames.length === 0) return

    const placeholders = schemaNames.map((_, i) => `$${i + 1}`).join(', ')
    const query = policiesQuery.replace('%s', placeholders)
    const result = await this.db.query(query, schemaNames)

    const schemaMap = new Map(realm.schemas.map((s) => [s.name, s]))

    for (const row of result.rows) {
      const schemaName = scanString(row, 0)
      const tableName = scanString(row, 1)
      const policyName = scanString(row, 2)
      const permissive = scanString(row, 3)
      const cmd = scanString(row, 4)
      const roles = scanString(row, 5)
      const using = scanString(row, 6)
      const check = scanString(row, 7)

      if (!schemaName || !tableName || !policyName) continue

      const s = schemaMap.get(schemaName)
      if (!s) continue

      const policy: Policy = {
        name: policyName,
        permissive: permissive === 'permissive',
        cmd: cmd || undefined,
        using: using || undefined,
        check: check || undefined,
      }

      if (roles) {
        policy.roles = roles.split(',')
      }

      // Attach to table
      for (const tbl of s.tables ?? []) {
        if (tbl.name === tableName) {
          if (!tbl.policies) tbl.policies = []
          tbl.policies.push(policy)
          break
        }
      }
    }
  }

  // -- Dependency Inspection --

  private async inspectDeps(realm: Realm): Promise<void> {
    const result = await this.db.query(depsQuery)

    // Build lookup maps
    const tables = new Map<string, Table>()
    const views = new Map<string, View>()
    const funcs = new Map<string, Func>()
    const procs = new Map<string, Proc>()

    for (const s of realm.schemas) {
      for (const t of s.tables ?? []) tables.set(`${s.name}.${t.name}`, t)
      for (const v of s.views ?? []) views.set(`${s.name}.${v.name}`, v)
      for (const f of s.funcs ?? []) funcs.set(`${s.name}.${f.name}`, f)
      for (const p of s.procs ?? []) procs.set(`${s.name}.${p.name}`, p)
    }

    const resolve = (ns: string, name: string, kind: string): ObjectRef | undefined => {
      const key = `${ns}.${name}`
      switch (kind) {
        case 'table':
          if (tables.has(key)) return { type: 'table', name, schema: ns }
          break
        case 'view':
        case 'matview':
          if (views.has(key)) return { type: 'view', name, schema: ns }
          break
        case 'function':
          if (funcs.has(key)) return { type: 'func', name, schema: ns }
          break
        case 'procedure':
          if (procs.has(key)) return { type: 'proc', name, schema: ns }
          break
        case 'composite':
          // Every table has an implicit composite type
          if (tables.has(key)) return { type: 'table', name, schema: ns }
          // Also check actual composite types
          for (const s of realm.schemas) {
            if (s.name === ns) {
              if (s.compositeTypes?.some((ct) => ct.T === name))
                return { type: 'compositeType', name, schema: ns } as any
            }
          }
          break
        case 'type':
        case 'enum':
          // Enum, domain, or other type object
          for (const s of realm.schemas) {
            if (s.name === ns) {
              if (s.enums?.some((e) => e.T === name)) return { type: 'enum', name, schema: ns } as any
              if ((s.attrs as any[])?.some((a) => a?.kind === 'domain' && a.T === name))
                return { type: 'domainType', name, schema: ns } as any
              if (s.compositeTypes?.some((ct) => ct.T === name))
                return { type: 'compositeType', name, schema: ns } as any
            }
          }
          break
      }
      return undefined
    }

    for (const row of result.rows) {
      const srcSchema = scanString(row, 0)
      const srcName = scanString(row, 1)
      const srcKind = scanString(row, 2)
      const depSchema = scanString(row, 3)
      const depName = scanString(row, 4)
      const depKind = scanString(row, 5)

      if (!srcSchema || !srcName || !depSchema || !depName) continue

      const dep = resolve(depSchema, depName, depKind || '')
      if (!dep) continue

      const srcKey = `${srcSchema}.${srcName}`
      switch (srcKind) {
        case 'function': {
          const f = funcs.get(srcKey)
          if (f) {
            if (!f.deps) f.deps = []
            f.deps.push(dep)
          }
          break
        }
        case 'procedure': {
          const p = procs.get(srcKey)
          if (p) {
            if (!p.deps) p.deps = []
            p.deps.push(dep)
          }
          break
        }
        case 'view':
        case 'matview': {
          const v = views.get(srcKey)
          if (v) {
            if (!v.deps) v.deps = []
            v.deps.push(dep)
          }
          break
        }
        case 'table': {
          const t = tables.get(srcKey)
          if (t) {
            if (!t.deps) t.deps = []
            t.deps.push(dep)
          }
          break
        }
      }
    }

    // Supplement with body-based dependency detection for functions and views
    // (pg_depend doesn't track runtime references in function/procedure bodies)
    this.detectBodyDeps(realm, tables, funcs, procs, views)
  }

  /** Detect dependencies by scanning function bodies and view definitions for object references. */
  private detectBodyDeps(
    realm: Realm,
    _tables: Map<string, Table>,
    _funcs: Map<string, Func>,
    _procs: Map<string, Proc>,
    _views: Map<string, View>,
  ): void {
    for (const s of realm.schemas) {
      // Functions: scan bodies for table and function references
      for (const f of s.funcs ?? []) {
        if (!f.body) continue
        const words = tokenize(f.body)

        for (const t of s.tables ?? []) {
          if (words.has(t.name.toLowerCase()) && !hasDep(f.deps, 'table', t.name)) {
            if (!f.deps) f.deps = []
            f.deps.push({ type: 'table', name: t.name, schema: s.name })
          }
        }
        for (const f2 of s.funcs ?? []) {
          if (f2 !== f && words.has(f2.name.toLowerCase()) && !hasDep(f.deps, 'func', f2.name)) {
            if (!f.deps) f.deps = []
            f.deps.push({ type: 'func', name: f2.name, schema: s.name })
          }
        }
      }

      // Procedures: scan bodies for table references
      for (const p of s.procs ?? []) {
        if (!p.body) continue
        const words = tokenize(p.body)
        for (const t of s.tables ?? []) {
          if (words.has(t.name.toLowerCase()) && !hasDep(p.deps, 'table', t.name)) {
            if (!p.deps) p.deps = []
            p.deps.push({ type: 'table', name: t.name, schema: s.name })
          }
        }
      }

      // Views: scan definitions for table/function/view references
      for (const v of s.views ?? []) {
        if (!v.def) continue
        const words = tokenize(v.def)
        for (const t of s.tables ?? []) {
          if (words.has(t.name.toLowerCase()) && !hasDep(v.deps, 'table', t.name)) {
            if (!v.deps) v.deps = []
            v.deps.push({ type: 'table', name: t.name, schema: s.name })
          }
        }
        for (const f of s.funcs ?? []) {
          if (words.has(f.name.toLowerCase()) && !hasDep(v.deps, 'func', f.name)) {
            if (!v.deps) v.deps = []
            v.deps.push({ type: 'func', name: f.name, schema: s.name })
          }
        }
        for (const v2 of s.views ?? []) {
          if (v2 !== v && words.has(v2.name.toLowerCase()) && !hasDep(v.deps, 'view', v2.name)) {
            if (!v.deps) v.deps = []
            v.deps.push({ type: 'view', name: v2.name, schema: s.name })
          }
        }
      }
    }
  }

  // -- Query Helpers --

  /**
   * Build a query that filters by schema names AND table names.
   * Queries with two %s placeholders: first for schema names, second for table names.
   */
  private buildSchemaTableQuery(queryTemplate: string, schemas: Schema[]): { query: string; args: unknown[] } {
    const args: unknown[] = []
    for (const s of schemas) {
      args.push(s.name)
    }
    const nSchemas = args.length
    for (const s of schemas) {
      for (const t of s.tables ?? []) {
        args.push(t.name)
      }
    }
    const nTables = args.length - nSchemas

    // Replace the first %s with schema placeholders and second %s with table placeholders
    let query = queryTemplate
    const firstIdx = query.indexOf('%s')
    if (firstIdx !== -1) {
      query = query.slice(0, firstIdx) + nArgs(0, nSchemas) + query.slice(firstIdx + 2)
    }
    const secondIdx = query.indexOf('%s')
    if (secondIdx !== -1) {
      query = query.slice(0, secondIdx) + nArgs(nSchemas, nTables) + query.slice(secondIdx + 2)
    }

    return { query, args }
  }

  // -- Current Schema --

  async currentSchema(): Promise<string> {
    const result = await this.db.query('SELECT current_schema()', [])
    const schema = scanString(result.rows[0] as unknown[], 0)
    if (!schema) throw new Error('failed to detect current schema from database connection')
    return schema
  }
}

// -- Column Type Resolution (matches Go resolveColumnTypes) --

/**
 * Resolve column types that reference enums, domains, or composites.
 * After inspecting all types and tables, columns with UserDefinedType (kind: 'unknown')
 * pointing to a known enum/domain/composite get replaced with the actual type.
 * Also resolves array inner types and composite fields.
 * Matches Go's resolveColumnTypes in inspect_oss.go.
 */
function resolveColumnTypes(realm: Realm): void {
  // Build realm-wide lookup of type names → objects.
  // Keys include both unqualified ("color") and qualified ("b.color") forms.
  const enums = new Map<string, EnumType>()
  const domains = new Map<string, DomainType>()
  const composites = new Map<string, CompositeType>()

  for (const s of realm.schemas) {
    for (const e of s.enums ?? []) {
      enums.set(e.T, e)
      if (s.name) enums.set(`${s.name}.${e.T}`, e)
    }
    // Domains stored in attrs by inspectDomains
    for (const a of (s.attrs ?? []) as any[]) {
      if (a?.kind === 'domain') {
        const d = a as DomainType
        domains.set(d.T, d)
        if (d.schema) domains.set(`${d.schema}.${d.T}`, d)
      }
    }
    for (const ct of s.compositeTypes ?? []) {
      composites.set(ct.T, ct)
      if (s.name) composites.set(`${s.name}.${ct.T}`, ct)
    }
  }

  /**
   * Resolve a single column type or SchemaType.
   * Handles UserDefinedType (kind: 'unknown' with class) from table columns
   * and UnsupportedType from composite fields.
   */
  function resolveType(colType: ColumnType | undefined): void {
    if (!colType?.type) return
    const t = colType.type

    // Handle array inner types
    if (t.kind === 'array') {
      const arr = t as any
      if (arr.type && (arr.type.kind === 'unknown' || arr.type.kind === 'unsupported')) {
        const innerName = arr.type.T as string
        if (enums.has(innerName)) {
          arr.type = enums.get(innerName)!
        } else if (domains.has(innerName)) {
          arr.type = domains.get(innerName)!
        } else if (composites.has(innerName)) {
          arr.type = buildCompositeColumnType(composites.get(innerName)!)
        }
      }
      return
    }

    if (t.kind !== 'unsupported' && t.kind !== 'unknown') return

    const name = t.T
    const cls = (t as any).class as string | undefined

    // Match Go: resolve based on class (typtype) from UserDefinedType.C
    switch (cls) {
      case 'e':
        if (enums.has(name)) {
          colType.type = enums.get(name)!
        }
        return
      case 'd':
        if (domains.has(name)) {
          colType.type = domains.get(name)!
        }
        return
      case 'c':
        if (composites.has(name)) {
          // For composites, build the output format matching Go's marshal (compositeFields)
          const ct = composites.get(name)!
          colType.type = buildCompositeColumnType(ct)
        }
        return
    }

    // No class info (e.g. from composite fields parsed via ParseType) —
    // try matching by name against known enums, domains, composites.
    if (enums.has(name)) {
      colType.type = enums.get(name)!
    } else if (domains.has(name)) {
      colType.type = domains.get(name)!
    } else {
      // Try stripping schema prefix as a last resort
      const stripped = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
      if (stripped !== name) {
        if (enums.has(stripped)) {
          colType.type = enums.get(stripped)!
        } else if (domains.has(stripped)) {
          colType.type = domains.get(stripped)!
        }
      }
    }
  }

  // Resolve column types across all schemas (tables only — matches Go)
  for (const s of realm.schemas) {
    for (const t of s.tables ?? []) {
      for (const c of t.columns) {
        const wasBefore = c.type?.type?.kind
        resolveType(c.type)
        // Re-classify defaults when type was resolved (e.g. enum cast stripping)
        if ((wasBefore === 'unsupported' || wasBefore === 'unknown') && c.type?.type?.kind !== wasBefore && c.default) {
          const raw = 'X' in c.default ? (c.default as any).X : 'V' in c.default ? (c.default as any).V : undefined
          if (raw) c.default = classifyDefault(raw, c.type.type)
        }
      }
    }
  }
}

/**
 * Build a composite type representation for column output, using "compositeFields"
 * key to match Go's atlas-wasi marshal format.
 */
function buildCompositeColumnType(ct: CompositeType): SchemaType {
  const fields = ct.fields.map((f) => ({
    name: f.name,
    type: f.type,
  }))
  return {
    kind: 'composite',
    T: ct.T,
    compositeFields: fields,
    schema: ct.schema,
  } as any
}

/**
 * Apply time aliases to a SchemaType, matching Go's parseColumn → timeAlias behavior.
 * Go's timeAlias converts canonical forms to short aliases:
 *   "timestamp with time zone" → "timestamptz"
 *   "timestamp without time zone" → "timestamp"
 *   "time with time zone" → "timetz"
 *   "time without time zone" → "time"
 */
function applyTimeAlias(t: SchemaType): void {
  if (!t?.T) return
  const aliases: Record<string, string> = {
    'timestamp with time zone': 'timestamptz',
    'timestamp without time zone': 'timestamp',
    'time with time zone': 'timetz',
    'time without time zone': 'time',
  }
  const alias = aliases[t.T.toLowerCase()]
  if (alias) {
    ;(t as any).T = alias
  }
}

/**
 * Apply DB column metadata to a parsed SchemaType.
 * Go's columnType receives precision/scale/size from the DB row;
 * our parseType only gets what's in the type string.
 * This fills in missing values from information_schema.columns.
 */
function applyColumnMetadata(
  t: SchemaType,
  numPrecision: number | null,
  _dtPrecision: number | null,
  maxLen: number | null,
  numScale: number | null,
): void {
  switch (t.kind) {
    case 'float':
      // DB provides numeric_precision for float types (e.g. 53 for double precision)
      if (numPrecision != null && numPrecision > 0 && !(t as any).precision) {
        ;(t as any).precision = numPrecision
      }
      break
    case 'decimal':
      if (numPrecision != null && numPrecision > 0 && !(t as any).precision) {
        ;(t as any).precision = numPrecision
      }
      if (numScale != null && numScale > 0 && !(t as any).scale) {
        ;(t as any).scale = numScale
      }
      break
    case 'string':
      if (maxLen != null && maxLen > 0 && !(t as any).size) {
        ;(t as any).size = maxLen
      }
      break
  }
}

// -- Utility Functions --

/** Tokenize a string into lowercase word tokens for dependency matching. */
function tokenize(body: string): Set<string> {
  const words = new Set<string>()
  let buf = ''
  for (const ch of body.toLowerCase()) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '_') {
      buf += ch
    } else {
      if (buf.length > 0) {
        // Skip very short tokens that commonly cause false positive matches
        if (buf.length >= 3) words.add(buf)
        buf = ''
      }
    }
  }
  if (buf.length >= 3) words.add(buf)
  return words
}

/** Check if a deps array already contains a reference to the given object. */
function hasDep(deps: ObjectRef[] | undefined, type: ObjectRef['type'], name: string): boolean {
  if (!deps) return false
  return deps.some((d) => d.type === type && d.name === name)
}

// -- Default value classification (matches Go atlas sql/postgres/inspect_oss.go) --

/** Check if a string is a single-quoted value with proper escaping. */
function isQuoted(s: string, quote: string): boolean {
  if (s.length < 2 || s[0] !== quote || s[s.length - 1] !== quote) return false
  for (let i = 1; i < s.length - 1; i++) {
    const c = s[i]
    if (c === '\\' || (c === quote && s[i + 1] === quote)) {
      i++ // skip escaped char
    } else if (c === quote) {
      return false // unescaped quote in middle
    }
  }
  return true
}

function isLiteralBool(s: string): boolean {
  return /^(true|false|0|1|t|f|yes|no|on|off)$/i.test(s)
}

function isLiteralNumber(s: string): boolean {
  if (s.startsWith('0x') || s.startsWith('0X')) {
    return /^[0-9a-fA-F]+$/.test(s.slice(2))
  }
  return !Number.isNaN(Number(s)) && s.trim() !== ''
}

/**
 * Classify a default value as Literal or RawExpr, then try to convert
 * cast expressions to literals when the type allows it.
 * Matches Go: defaultExpr() + canConvert() in sql/postgres/inspect_oss.go
 */
function classifyDefault(s: string, colType?: SchemaType): { V: string } | { X: string } {
  // Step 1: check if it's directly a literal
  if (isLiteralBool(s) || isLiteralNumber(s) || isQuoted(s, "'")) {
    return { V: s }
  }
  // Step 2: try to convert cast expressions (e.g. 'foo'::text → 'foo')
  const castIdx = s.lastIndexOf('::')
  if (castIdx > 0 && isQuoted(s.slice(0, castIdx), "'")) {
    const quoted = s.slice(0, castIdx) // includes quotes: 'value'
    const inner = s.slice(1, castIdx - 1) // without quotes: value
    if (colType) {
      switch (colType.kind) {
        case 'enum':
          return { V: quoted }
        case 'boolean':
          if (isLiteralBool(inner)) return { V: inner }
          break
        case 'decimal':
        case 'integer':
        case 'float':
          if (isLiteralNumber(inner)) return { V: inner }
          break
        case 'array':
        case 'binary':
        case 'json':
        case 'network':
        case 'spatial':
        case 'string':
        case 'time':
        case 'uuid':
        case 'xml':
          return { V: quoted }
      }
    }
  }
  // Step 3: everything else is a raw expression
  return { X: s }
}
