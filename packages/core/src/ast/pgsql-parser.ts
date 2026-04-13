import { loadModule, parseSync } from 'pgsql-parser'
import { debug } from '../debug.ts'
import type { SqlAstAdapter } from './adapter.ts'
import { SqlparserTsAdapter } from './sqlparser-ts.ts'
import type { SqlColumn, SqlCommentOn, SqlStatement } from './types.ts'

interface PgParseResult {
  stmts?: PgRawStmt[]
}

interface PgRawStmt {
  stmt?: Record<string, any>
  stmt_location?: number
}

type LineLookup = (offset?: number | null) => number

export class PostgresAstAdapter implements SqlAstAdapter {
  private initialized = false
  private fallback = new SqlparserTsAdapter('postgres')

  async init(): Promise<void> {
    if (this.initialized) return
    await Promise.all([loadModule(), this.fallback.init()])
    this.initialized = true
  }

  parseStatements(sql: string): SqlStatement[] {
    this.assertInitialized()

    let result: PgParseResult
    try {
      result = parseSync(sql) as PgParseResult
    } catch (err: any) {
      debug('ast', `pgsql-parser parse failed: ${err?.message ?? String(err)}, falling back to sqlparser-ts`)
      return this.fallback.parseStatements(sql)
    }

    const lineLookup = createByteLineLookup(sql)
    const statements = (result.stmts ?? []).map((rawStmt) => mapStatement(rawStmt, lineLookup)).filter(isPresent)
    if (statements.length > 0) return statements
    return this.tryFallbackStatements(sql)
  }

  parseComments(sql: string): SqlCommentOn[] {
    this.assertInitialized()

    let result: PgParseResult
    try {
      result = parseSync(sql) as PgParseResult
    } catch (err: any) {
      debug('ast', `pgsql-parser comment parse failed: ${err?.message ?? String(err)}, falling back to sqlparser-ts`)
      return this.fallback.parseComments(sql)
    }

    const lineLookup = createByteLineLookup(sql)
    return (result.stmts ?? []).map((stmt) => mapComment(stmt, lineLookup)).filter(isPresent)
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('PostgresAstAdapter not initialized. Call init() first.')
    }
  }

  private tryFallbackStatements(sql: string): SqlStatement[] {
    try {
      return this.fallback.parseStatements(sql)
    } catch (err: any) {
      debug('ast', `sqlparser-ts fallback parse failed: ${err?.message ?? String(err)}`)
      return []
    }
  }
}

function mapStatement(rawStmt: PgRawStmt, lineLookup: LineLookup): SqlStatement | null {
  const stmt = rawStmt.stmt
  if (!stmt) return null

  const key = Object.keys(stmt)[0]
  const node = stmt[key]
  const line = lineLookup(statementOffset(key, node, rawStmt))

  switch (key) {
    case 'CreateStmt':
      return {
        kind: 'table',
        name: relationName(node.relation),
        line,
        columns: mapColumns(node.tableElts, lineLookup),
        node,
      }
    case 'ViewStmt':
      return {
        kind: 'view',
        name: relationName(node.view),
        line,
        columns: [],
        node,
      }
    case 'IndexStmt':
      return {
        kind: 'index',
        name: node.idxname ?? relationName(node.relation),
        line,
        columns: [],
        node,
      }
    case 'CompositeTypeStmt':
      return {
        kind: 'type',
        name: relationName(node.typevar),
        line,
        columns: mapColumns(node.coldeflist, lineLookup),
        node,
      }
    case 'CreateEnumStmt':
      return {
        kind: 'type',
        name: nameList(node.typeName),
        line,
        columns: [],
        node,
      }
    case 'CreateFunctionStmt':
      return {
        kind: 'function',
        name: nameList(node.funcname),
        line,
        columns: [],
        node,
      }
    case 'CreateTrigStmt':
      return {
        kind: 'trigger',
        name: node.trigname ?? '',
        line,
        columns: [],
        node,
      }
    default:
      return null
  }
}

function mapComment(rawStmt: PgRawStmt, lineLookup: LineLookup): SqlCommentOn | null {
  const stmt = rawStmt.stmt?.CommentStmt
  if (!stmt) return null

  const names = listItems(stmt.object?.List?.items)
  const line = lineLookup(commentOffset(stmt, rawStmt))
  const text = String(stmt.comment ?? '')

  switch (stmt.objtype) {
    case 'OBJECT_COLUMN':
      if (names.length >= 2) {
        return {
          targetKey: `COLUMN "${names[names.length - 2]}"."${names[names.length - 1]}"`,
          text,
          line,
        }
      }
      return null
    case 'OBJECT_TABLE':
      return { targetKey: `TABLE "${names[names.length - 1] ?? ''}"`, text, line }
    case 'OBJECT_VIEW':
      return { targetKey: `VIEW "${names[names.length - 1] ?? ''}"`, text, line }
    case 'OBJECT_INDEX':
      return { targetKey: `INDEX "${names[names.length - 1] ?? ''}"`, text, line }
    case 'OBJECT_TRIGGER':
      return { targetKey: `TRIGGER "${names[names.length - 1] ?? ''}"`, text, line }
    case 'OBJECT_FUNCTION':
      return { targetKey: `FUNCTION "${names[names.length - 1] ?? ''}"`, text, line }
    default:
      return null
  }
}

function mapColumns(tableElts: any[] | undefined, lineLookup: LineLookup): SqlColumn[] {
  return (tableElts ?? [])
    .map((elt) => elt?.ColumnDef)
    .filter(isPresent)
    .map((column) => ({
      name: column.colname ?? '',
      type: normalizeTypeName(column.typeName),
      line: lineLookup(column.location ?? column.typeName?.location ?? 0),
    }))
}

function relationName(relation: any): string {
  if (!relation) return ''
  return relation.schemaname ? `${relation.schemaname}.${relation.relname ?? ''}` : (relation.relname ?? '')
}

function nameList(names: any[] | undefined): string {
  return listItems(names).join('.')
}

function listItems(items: any[] | undefined): string[] {
  return (items ?? []).map((item) => item?.String?.sval).filter((value): value is string => typeof value === 'string')
}

function normalizeTypeName(typeName: any): string {
  const names = listItems(typeName?.names)
  const base = (names[names.length - 1] ?? 'unknown').toLowerCase()
  if (Array.isArray(typeName?.arrayBounds) && typeName.arrayBounds.length > 0) {
    return `${base}[]`
  }
  return PG_TYPE_ALIASES[base] ?? base
}

function statementOffset(key: string, node: any, rawStmt: PgRawStmt): number {
  switch (key) {
    case 'CreateStmt':
    case 'IndexStmt':
      return node?.relation?.location ?? rawStmt.stmt_location ?? 0
    case 'ViewStmt':
      return node?.view?.location ?? rawStmt.stmt_location ?? 0
    case 'CompositeTypeStmt':
      return node?.typevar?.location ?? rawStmt.stmt_location ?? 0
    case 'CreateEnumStmt':
      return node?.typeName?.[0]?.String?.location ?? rawStmt.stmt_location ?? 0
    case 'CreateFunctionStmt':
      return node?.funcname?.[0]?.String?.location ?? rawStmt.stmt_location ?? 0
    case 'CreateTrigStmt':
      return node?.relation?.location ?? rawStmt.stmt_location ?? 0
    default:
      return node?.location ?? rawStmt.stmt_location ?? 0
  }
}

function commentOffset(stmt: any, rawStmt: PgRawStmt): number {
  return stmt.object?.List?.items?.[0]?.String?.location ?? rawStmt.stmt_location ?? 0
}

function createByteLineLookup(sql: string): LineLookup {
  const bytes = Buffer.from(sql, 'utf8')
  const lineOffsets = [0]
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 10) lineOffsets.push(i + 1)
  }

  return (offset = 0) => {
    let resolvedOffset = offset ?? 0
    while (resolvedOffset < bytes.length && isAsciiWhitespace(bytes[resolvedOffset])) {
      resolvedOffset += 1
    }
    let low = 0
    let high = lineOffsets.length - 1
    let best = 0

    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if (lineOffsets[mid] <= resolvedOffset) {
        best = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    return best + 1
  }
}

function isAsciiWhitespace(byte: number | undefined): boolean {
  return byte === 9 || byte === 10 || byte === 13 || byte === 32
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null
}

const PG_TYPE_ALIASES: Record<string, string> = {
  bool: 'boolean',
  bpchar: 'char',
  float4: 'real',
  float8: 'double precision',
  int2: 'smallint',
  int4: 'integer',
  int8: 'bigint',
  timestamptz: 'timestamptz',
  timetz: 'timetz',
  varbit: 'bit varying',
  varchar: 'varchar',
}
