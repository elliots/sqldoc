import * as sp from '@sqldoc/sqlparser-ts'
import type { SqlAstAdapter } from './adapter.ts'
import type { SqlColumn, SqlCommentOn, SqlStatement } from './types.ts'

/**
 * AST adapter backed by @sqldoc/sqlparser-ts (WASM-based, multi-dialect).
 * Uses real span info from the parser for line-based matching.
 */
export class SqlparserTsAdapter implements SqlAstAdapter {
  private initialized = false
  private parseFn!: (sql: string, dialect?: any) => any[]
  private dialect: string

  constructor(dialect: 'postgres' | 'mysql' | 'sqlite') {
    this.dialect = dialect
  }

  async init(): Promise<void> {
    if (this.initialized) return
    await sp.init()
    this.parseFn = sp.parse
    this.initialized = true
  }

  parseStatements(sql: string): SqlStatement[] {
    if (!this.initialized) {
      throw new Error('SqlparserTsAdapter not initialized. Call init() first.')
    }

    let ast: any[]
    try {
      ast = this.parseFn(sql, this.dialect)
    } catch {
      // Full parse failed — try statement by statement
      return this.parseStatementByStatement(sql)
    }

    const results: SqlStatement[] = []
    for (const stmt of ast) {
      const mapped = mapStatement(stmt)
      if (mapped) results.push(mapped)
    }
    return results
  }

  // Fallback: when the full-file parse fails (e.g. due to dialect-specific syntax),
  // each statement is parsed individually so partial results are still available.
  private parseStatementByStatement(sql: string): SqlStatement[] {
    const results: SqlStatement[] = []
    const chunks = splitStatements(sql)
    let charOffset = 0
    for (const chunk of chunks) {
      const trimmed = chunk.trim()
      if (!trimmed) {
        charOffset += chunk.length + 1 // +1 for semicolon
        continue
      }
      // Count newlines before this chunk to get line offset
      const lineOffset = sql.substring(0, charOffset + chunk.indexOf(trimmed[0])).split('\n').length - 1
      try {
        const ast = this.parseFn(`${trimmed};`, this.dialect)
        for (const stmt of ast) {
          const mapped = mapStatement(stmt)
          if (mapped) {
            mapped.line += lineOffset
            if (mapped.columns) {
              for (const col of mapped.columns) {
                col.line += lineOffset
              }
            }
            results.push(mapped)
          }
        }
      } catch {
        // Skip unparseable statements
      }
      charOffset += chunk.length + 1
    }
    return results
  }

  parseComments(sql: string): SqlCommentOn[] {
    if (!this.initialized) {
      throw new Error('SqlparserTsAdapter not initialized. Call init() first.')
    }

    let ast: any[]
    try {
      ast = this.parseFn(sql, this.dialect)
    } catch {
      return []
    }

    const results: SqlCommentOn[] = []
    for (const stmt of ast) {
      const key = Object.keys(stmt)[0]
      if (key !== 'Comment') continue

      const node = stmt.Comment
      const objectType = node.object_type as string
      const names = extractNames(node.object_name)
      const comment = node.comment as string

      let targetKey: string
      if (objectType === 'Column' && names.length >= 2) {
        targetKey = `COLUMN "${names[names.length - 2]}"."${names[names.length - 1]}"`
      } else {
        targetKey = `${objectType.toUpperCase()} "${names[names.length - 1] ?? ''}"`
      }

      const line = getSpanLine(node.object_name?.[0])
      results.push({ targetKey, content: comment, line })
    }

    return results
  }
}

// ── Statement splitting ─────────────────────────────────────────────

/** Split SQL on semicolons, respecting $$ dollar-quoted blocks */
function splitStatements(sql: string): string[] {
  const results: string[] = []
  let current = ''
  let inDollarQuote = false
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '$' && sql[i + 1] === '$') {
      inDollarQuote = !inDollarQuote
      current += '$$'
      i++
      continue
    }
    if (sql[i] === ';' && !inDollarQuote) {
      results.push(current)
      current = ''
      continue
    }
    current += sql[i]
  }
  if (current.trim()) results.push(current)
  return results
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Extract the start line (1-based) from an AST node's span */
function getSpanLine(node: any): number {
  if (!node) return 1
  const span = node.Identifier?.span ?? node.span
  return span?.start?.line ?? 1
}

/** Extract names from a name array */
function extractNames(nameArray: any[]): string[] {
  if (!nameArray) return []
  return nameArray.map((n: any) => n.Identifier?.value ?? n?.value).filter(Boolean)
}

function extractName(nameArray: any[]): string {
  return extractNames(nameArray).join('.')
}

/** Map an AST statement node to our SqlStatement type */
function mapStatement(stmt: any): SqlStatement | null {
  const key = Object.keys(stmt)[0]
  const node = stmt[key]

  switch (key) {
    case 'CreateTable':
      return {
        kind: 'table',
        objectName: extractName(node.name),
        line: getSpanLine(node.name?.[0]),
        columns: mapColumns(node.columns ?? []),
        raw: node,
      }
    case 'CreateView':
      return { kind: 'view', objectName: extractName(node.name), line: getSpanLine(node.name?.[0]), raw: node }
    case 'CreateIndex':
      return { kind: 'index', objectName: extractName(node.name), line: getSpanLine(node.name?.[0]), raw: node }
    case 'CreateType':
      return { kind: 'type', objectName: extractName(node.name), line: getSpanLine(node.name?.[0]), raw: node }
    case 'CreateFunction':
      return { kind: 'function', objectName: extractName(node.name), line: getSpanLine(node.name?.[0]), raw: node }
    case 'CreateTrigger':
      return { kind: 'trigger', objectName: extractName(node.name), line: getSpanLine(node.name?.[0]), raw: node }
    default:
      return null
  }
}

/** Map columns using span info from the AST */
function mapColumns(columns: any[]): SqlColumn[] {
  return columns.map((col: any) => ({
    name: col.name?.value ?? '',
    dataType: normalizeDataType(col.data_type),
    line: col.name?.span?.start?.line ?? 1,
    raw: col,
  }))
}

/**
 * Normalize sqlparser-ts data type representations to lowercase strings.
 */
export function normalizeDataType(dt: any): string {
  if (typeof dt === 'string') return dt.toLowerCase()
  if (dt?.Varchar != null) {
    const len = dt.Varchar?.IntegerLength?.length
    return len != null ? `varchar(${len})` : 'varchar'
  }
  if (dt?.Custom) {
    return dt.Custom[0]
      ?.map((n: any) => n.Identifier?.value)
      .filter(Boolean)
      .join('.')
      .toLowerCase()
  }
  if (dt?.Timestamp != null) {
    return dt.Timestamp?.With === 'Tz' ? 'timestamptz' : 'timestamp'
  }
  // Fallback: use first key name lowercased
  const keys = Object.keys(dt)
  if (keys.length === 1) return keys[0].toLowerCase()
  return JSON.stringify(dt)
}
