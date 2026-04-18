import * as sp from '@sqldoc/sqlparser-ts'
import { debug } from '../debug.ts'
import type { Dialect } from '../sql-emitter.ts'
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

  constructor(dialect: Dialect) {
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

    // MSSQL: split on GO batch separators first, parse each batch independently.
    // GO is a client-side batch separator, not a SQL keyword. Parsing each batch
    // in isolation prevents CREATE PROCEDURE bodies from interfering with other statements.
    if (this.dialect === 'mssql') {
      return this.parseMssqlBatches(sql)
    }

    let ast: any[]
    try {
      ast = this.parseFn(sql, this.dialect)
    } catch (err: any) {
      // Full parse failed — try statement by statement
      debug('ast', `full parse failed (${this.dialect}): ${err?.message ?? String(err)}, trying statement-by-statement`)
      return this.parseStatementByStatement(sql)
    }

    const results: SqlStatement[] = []
    for (const stmt of ast) {
      const mapped = mapStatement(stmt)
      if (mapped) results.push(mapped)
    }
    debug('ast', `parsed ${results.length} statement(s) (${this.dialect})`)
    return results
  }

  /**
   * MSSQL: split on GO batch separators, parse each batch independently.
   * This isolates CREATE PROCEDURE/FUNCTION bodies so they don't interfere
   * with parsing of other statements.
   */
  private parseMssqlBatches(sql: string): SqlStatement[] {
    const results: SqlStatement[] = []
    // Split on GO lines, tracking line offsets
    const lines = sql.split('\n')
    let batchStart = 0
    const batches: Array<{ text: string; lineOffset: number }> = []

    for (let i = 0; i < lines.length; i++) {
      if (/^\s*GO\s*$/i.test(lines[i])) {
        const text = lines.slice(batchStart, i).join('\n')
        if (text.trim()) batches.push({ text, lineOffset: batchStart })
        batchStart = i + 1
      }
    }
    // Last batch after final GO (or entire file if no GO)
    const lastBatch = lines.slice(batchStart).join('\n')
    if (lastBatch.trim()) batches.push({ text: lastBatch, lineOffset: batchStart })

    for (const batch of batches) {
      try {
        const ast = this.parseFn(batch.text, this.dialect)
        for (const stmt of ast) {
          const mapped = mapStatement(stmt)
          if (mapped) {
            mapped.line += batch.lineOffset
            if (mapped.columns) {
              for (const col of mapped.columns) col.line += batch.lineOffset
            }
            results.push(mapped)
          }
        }
      } catch {
        // Batch failed full parse — split on `;` respecting BEGIN/END block depth
        const chunks = splitMssqlStatements(batch.text)
        for (const chunk of chunks) {
          const trimmed = chunk.text.trim()
          if (!trimmed) continue
          const lineOffset = batch.lineOffset + chunk.lineOffset
          try {
            const ast = this.parseFn(`${trimmed};`, this.dialect)
            for (const stmt of ast) {
              const mapped = mapStatement(stmt)
              if (mapped) {
                mapped.line += lineOffset
                if (mapped.columns) {
                  for (const col of mapped.columns) col.line += lineOffset
                }
                results.push(mapped)
              }
            }
          } catch (err: any) {
            debug(
              'ast',
              `skipping unparseable MSSQL statement at line ${lineOffset + 1}: ${err?.message ?? String(err)}`,
            )
          }
        }
      }
    }

    debug('ast', `parsed ${results.length} statement(s) (mssql, ${batches.length} batch(es))`)
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
      } catch (err: any) {
        debug('ast', `skipping unparseable statement at line ${lineOffset + 1}: ${err?.message ?? String(err)}`)
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
        // names may be [schema, table, column] or [table, column]
        const colRef =
          names.length >= 3
            ? `"${names[names.length - 3]}"."${names[names.length - 2]}"."${names[names.length - 1]}"`
            : `"${names[names.length - 2]}"."${names[names.length - 1]}"`
        targetKey = `COLUMN ${colRef}`
      } else if (names.length >= 2) {
        // Schema-qualified: e.g. COMMENT ON TABLE "core"."tenants"
        targetKey = `${objectType.toUpperCase()} "${names[names.length - 2]}"."${names[names.length - 1]}"`
      } else {
        targetKey = `${objectType.toUpperCase()} "${names[names.length - 1] ?? ''}"`
      }

      const line = getSpanLine(node.object_name?.[0])
      results.push({ targetKey, text: comment, line })
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

/**
 * Split MSSQL SQL on `;` while respecting BEGIN/END block depth.
 * Treats everything inside a BEGIN...END block as a single statement
 * (e.g., stored procedures, triggers). Returns chunks with line offsets.
 */
function splitMssqlStatements(sql: string): Array<{ text: string; lineOffset: number }> {
  const results: Array<{ text: string; lineOffset: number }> = []
  let current = ''
  let depth = 0
  let lineOffset = 0
  let currentStartLine = 0
  let inString = false

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]

    // Track string literals (skip content inside quotes)
    if (ch === "'" && !inString) {
      inString = true
      current += ch
      continue
    }
    if (ch === "'" && inString) {
      // Check for escaped quote ''
      if (sql[i + 1] === "'") {
        current += "''"
        i++
        continue
      }
      inString = false
      current += ch
      continue
    }
    if (inString) {
      if (ch === '\n') lineOffset++
      current += ch
      continue
    }

    // Track BEGIN/END block depth (case-insensitive, word boundary)
    if (/\bBEGIN\b/i.test(sql.slice(i, i + 5)) && (i === 0 || /\s/.test(sql[i - 1]))) {
      depth++
    }
    const isEnd =
      /\bEND\b/i.test(sql.slice(i, i + 3)) &&
      (i === 0 || /\s/.test(sql[i - 1])) &&
      (i + 3 >= sql.length || /[\s;]/.test(sql[i + 3]))
    if (isEnd && depth > 0) {
      depth--
      // When END closes a top-level block (depth 1→0), emit the entire block as one statement
      if (depth === 0) {
        current += sql.slice(i, i + 3) // append "END"
        i += 2
        if (current.trim()) results.push({ text: current, lineOffset: currentStartLine })
        current = ''
        currentStartLine = lineOffset + 1
        continue
      }
    }

    // Split on `;` only when outside BEGIN/END blocks
    if (ch === ';' && depth === 0) {
      if (current.trim()) results.push({ text: current, lineOffset: currentStartLine })
      current = ''
      currentStartLine = lineOffset + 1
      continue
    }

    if (ch === '\n') lineOffset++
    current += ch
  }

  // Last statement (may not end with `;`)
  if (current.trim()) results.push({ text: current, lineOffset: currentStartLine })
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
        name: extractName(node.name),
        line: getSpanLine(node.name?.[0]),
        columns: mapColumns(node.columns ?? []),
        node,
      }
    case 'CreateView':
      return { kind: 'view', name: extractName(node.name), line: getSpanLine(node.name?.[0]), columns: [], node }
    case 'CreateIndex':
      return { kind: 'index', name: extractName(node.name), line: getSpanLine(node.name?.[0]), columns: [], node }
    case 'CreateType':
      return { kind: 'type', name: extractName(node.name), line: getSpanLine(node.name?.[0]), columns: [], node }
    case 'CreateFunction':
      return { kind: 'function', name: extractName(node.name), line: getSpanLine(node.name?.[0]), columns: [], node }
    case 'CreateTrigger':
      return { kind: 'trigger', name: extractName(node.name), line: getSpanLine(node.name?.[0]), columns: [], node }
    default:
      return null
  }
}

/** Map columns using span info from the AST */
function mapColumns(columns: any[]): SqlColumn[] {
  return columns.map((col: any) => ({
    name: col.name?.value ?? '',
    type: normalizeDataType(col.data_type),
    line: col.name?.span?.start?.line ?? 1,
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
