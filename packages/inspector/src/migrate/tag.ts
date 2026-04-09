// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/migrate/tag.go

import type { Tag } from '../schema/schema.ts'
import type { Stmt } from './lex.ts'

// -- Tag Parsing --

/** Check if a byte is an identifier character. */
function isIdent(c: number): boolean {
  return (
    (c >= 0x61 && c <= 0x7a) || // a-z
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x30 && c <= 0x39) || // 0-9
    c === 0x5f // _
  )
}

/** Scan a string for @-prefixed tags and return them. */
function scanTags(s: string): Tag[] {
  const tags: Tag[] = []
  let i = 0
  while (i < s.length) {
    const at = s.indexOf('@', i)
    if (at < 0) break

    // Read the tag name (word chars and dots).
    const nameStart = at + 1
    let nameEnd = nameStart
    while (nameEnd < s.length && (isIdent(s.charCodeAt(nameEnd)) || s.charCodeAt(nameEnd) === 0x2e) /* . */) {
      nameEnd++
    }
    const name = s.slice(nameStart, nameEnd)
    if (!name) {
      i = at + 1
      continue
    }

    // Check for parenthesized arguments.
    let args = ''
    let end = nameEnd
    if (end < s.length && s.charCodeAt(end) === 0x28 /* ( */) {
      let depth = 0
      const argStart = end + 1
      let j = end
      let found = false
      while (j < s.length) {
        if (s.charCodeAt(j) === 0x28) {
          depth++
        } else if (s.charCodeAt(j) === 0x29) {
          depth--
          if (depth === 0) {
            args = s.slice(argStart, j).trim()
            j++
            end = j
            found = true
            break
          }
        }
        j++
      }
      if (!found) {
        // Unbalanced parens -- treat as no args.
        end = nameEnd
      }
    }

    tags.push({ kind: 'tag', name, args })
    i = end
  }
  return tags
}

/** Extract @-prefixed tags from a single comment string. */
function parseTagsFromComment(c: string): Tag[] {
  c = c.trim()
  // Strip block comment delimiters.
  if (c.startsWith('/*')) {
    c = c.slice(2)
    if (c.endsWith('*/')) c = c.slice(0, -2)
  }
  const tags: Tag[] = []
  for (const rawLine of c.split('\n')) {
    let line = rawLine.trim()
    if (line.startsWith('--')) line = line.slice(2)
    else if (line.startsWith('#')) line = line.slice(1)
    else if (line.startsWith('*')) line = line.slice(1) // block comment continuation
    line = line.trim()
    tags.push(...scanTags(line))
  }
  return tags
}

/** Extract structured tags from SQL comment strings. */
export function parseTags(comments: string[]): Tag[] {
  const tags: Tag[] = []
  for (const c of comments) {
    tags.push(...parseTagsFromComment(c))
  }
  return tags
}

/** Return all annotation tags from a Stmt's associated comments. */
export function stmtTags(s: Stmt): Tag[] {
  return parseTags(s.comments)
}

// -- Statement Tag Parsing (CREATE TABLE aware) --

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a
}

function trimLeadingSpace(s: string): string {
  let i = 0
  while (i < s.length && isSpace(s.charCodeAt(i))) i++
  return s.slice(i)
}

/** Constraint keywords that indicate the line is NOT a column definition. */
const CONSTRAINT_KEYWORDS = [
  'PRIMARY ',
  'UNIQUE ',
  'CHECK ',
  'CHECK(',
  'CONSTRAINT ',
  'FOREIGN ',
  'INDEX ',
  'LIKE ',
  'EXCLUDE ',
]

/**
 * Parse a CREATE TABLE statement and extract per-column and table-level tags.
 *
 * Tag association rules:
 * - A comment before CREATE TABLE attaches to the table.
 * - An inline comment on the CREATE TABLE line attaches to the table.
 * - A comment on the same line as a column definition attaches to that column.
 * - A comment on a line before a column definition attaches to the next column.
 * - A comment after the last column (before the closing paren) attaches to the table.
 */
export function parseStmtTags(stmtText: string): { columnTags: Map<string, Tag[]>; tableTags: Tag[] } {
  const p = new StmtParser(stmtText)
  p.parse()
  return { columnTags: p.columnTags, tableTags: p.tableTags }
}

class StmtParser {
  private src: string
  private pos = 0
  private depth = 0

  private inBody = false
  private lineStart = 0
  private lineHasCol = false
  private lineCol = ''

  private pending: Tag[] = []

  tableTags: Tag[] = []
  columnTags: Map<string, Tag[]> = new Map()

  constructor(src: string) {
    this.src = src
  }

  parse(): void {
    while (this.pos < this.src.length) {
      const ch = this.src.charCodeAt(this.pos)

      // Line comment (--)
      if (ch === 0x2d && this.pos + 1 < this.src.length && this.src.charCodeAt(this.pos + 1) === 0x2d) {
        this.handleLineComment()
        continue
      }

      // Block comment (/*)
      if (ch === 0x2f && this.pos + 1 < this.src.length && this.src.charCodeAt(this.pos + 1) === 0x2a) {
        this.handleBlockComment()
        continue
      }

      // Single-quoted string
      if (ch === 0x27) {
        this.skipString(0x27)
        continue
      }

      // Double-quoted identifier
      if (ch === 0x22) {
        if (
          this.inBody &&
          this.depth === 1 &&
          !this.lineHasCol &&
          this.src.slice(this.lineStart, this.pos).trim() === ''
        ) {
          const end = this.src.indexOf('"', this.pos + 1)
          if (end >= 0) {
            const name = this.src.slice(this.pos + 1, end)
            this.pos = end + 1
            this.lineHasCol = true
            this.lineCol = name
            if (this.pending.length > 0) {
              this.appendColumnTags(name, this.pending)
              this.pending = []
            }
            continue
          }
        }
        this.skipString(0x22)
        continue
      }

      // Open paren
      if (ch === 0x28) {
        this.depth++
        if (this.depth === 1 && !this.inBody) {
          this.inBody = true
          this.tableTags.push(...this.pending)
          this.pending = []
        }
        this.pos++
        continue
      }

      // Close paren
      if (ch === 0x29) {
        if (this.depth === 1 && this.inBody) {
          this.tableTags.push(...this.pending)
          this.pending = []
          this.inBody = false
        }
        this.depth--
        this.pos++
        continue
      }

      // Comma at depth 1 (end of column def)
      if (ch === 0x2c && this.depth === 1 && this.inBody) {
        this.pos++
        continue
      }

      // Newline
      if (ch === 0x0a) {
        this.pos++
        this.lineStart = this.pos
        this.lineHasCol = false
        this.lineCol = ''
        continue
      }

      // Try to detect column name at start of meaningful content on a line
      if (this.inBody && this.depth === 1 && !this.lineHasCol && !isSpace(ch)) {
        const name = this.tryColumnName()
        if (name) {
          this.lineHasCol = true
          this.lineCol = name
          if (this.pending.length > 0) {
            this.appendColumnTags(name, this.pending)
            this.pending = []
          }
        }
      }

      this.pos++
    }

    // Handle any trailing pending tags.
    this.tableTags.push(...this.pending)
    this.pending = []
  }

  private handleLineComment(): void {
    const start = this.pos
    let end = this.src.indexOf('\n', this.pos)
    if (end < 0) end = this.src.length
    const comment = this.src.slice(start, end)
    this.pos = end

    const stripped = comment.trim().startsWith('--') ? comment.trim().slice(2) : comment.trim()
    const tags = scanTags(stripped)
    if (tags.length === 0) return

    const beforeComment = this.src.slice(this.lineStart, start).trim()
    if (beforeComment) {
      if (this.inBody && this.lineHasCol) {
        this.appendColumnTags(this.lineCol, tags)
      } else {
        this.tableTags.push(...tags)
      }
    } else {
      this.pending.push(...tags)
    }
  }

  private handleBlockComment(): void {
    const start = this.pos
    this.pos += 2
    const end = this.src.indexOf('*/', this.pos)
    if (end < 0) {
      this.pos = this.src.length
    } else {
      this.pos = end + 2
    }
    const comment = this.src.slice(start, this.pos)
    const tags = parseTagsFromComment(comment)
    if (tags.length === 0) return

    const beforeComment = this.src.slice(this.lineStart, start).trim()
    if (beforeComment) {
      if (this.inBody && this.lineHasCol) {
        this.appendColumnTags(this.lineCol, tags)
      } else {
        this.tableTags.push(...tags)
      }
    } else {
      this.pending.push(...tags)
    }
  }

  private tryColumnName(): string {
    const rest = this.src.slice(this.pos)
    const upper = trimLeadingSpace(rest).toUpperCase()
    for (const kw of CONSTRAINT_KEYWORDS) {
      if (upper.startsWith(kw)) return ''
    }
    // Quoted identifier
    if (rest.length > 0 && rest.charCodeAt(0) === 0x22) {
      const end = rest.indexOf('"', 1)
      if (end >= 0) return rest.slice(1, end)
      return ''
    }
    // Unquoted identifier
    let name = ''
    for (let i = 0; i < rest.length; i++) {
      if (isIdent(rest.charCodeAt(i))) {
        name += rest[i]
      } else {
        break
      }
    }
    return name
  }

  private skipString(quote: number): void {
    this.pos++ // skip opening quote
    while (this.pos < this.src.length) {
      if (this.src.charCodeAt(this.pos) === quote) {
        this.pos++
        // Handle escaped quote (double quote).
        if (this.pos < this.src.length && this.src.charCodeAt(this.pos) === quote) {
          this.pos++
          continue
        }
        return
      }
      this.pos++
    }
  }

  private appendColumnTags(col: string, tags: Tag[]): void {
    const existing = this.columnTags.get(col)
    if (existing) {
      existing.push(...tags)
    } else {
      this.columnTags.set(col, [...tags])
    }
  }
}

// -- Table Name Parsing --

function readIdent(s: string): [string, string] {
  if (s.length === 0) return ['', s]
  if (s.charCodeAt(0) === 0x22) {
    const end = s.indexOf('"', 1)
    if (end < 0) return ['', s]
    return [s.slice(1, end), s.slice(end + 1)]
  }
  let i = 0
  while (i < s.length && isIdent(s.charCodeAt(i))) i++
  return [s.slice(0, i), s.slice(i)]
}

/** Extract (schema, table) from a CREATE TABLE statement. */
export function parseTableName(s: string): { schema: string; table: string } {
  let p = s.trim()
  if (p.length < 12) return { schema: '', table: '' }
  if (p.slice(0, 6).toUpperCase() !== 'CREATE') return { schema: '', table: '' }
  p = trimLeadingSpace(p.slice(6))
  if (p.slice(0, 5).toUpperCase() !== 'TABLE') return { schema: '', table: '' }
  p = trimLeadingSpace(p.slice(5))

  // Optional IF NOT EXISTS
  if (p.length > 15 && p.slice(0, 2).toUpperCase() === 'IF') {
    let rest = trimLeadingSpace(p.slice(2))
    if (rest.slice(0, 3).toUpperCase() === 'NOT') {
      rest = trimLeadingSpace(rest.slice(3))
      if (rest.slice(0, 6).toUpperCase() === 'EXISTS') {
        p = trimLeadingSpace(rest.slice(6))
      }
    }
  }

  const [first, rest1] = readIdent(p)
  if (!first) return { schema: '', table: '' }
  const rest2 = trimLeadingSpace(rest1)
  if (rest2.length > 0 && rest2.charCodeAt(0) === 0x2e /* . */) {
    const rest3 = trimLeadingSpace(rest2.slice(1))
    const [second] = readIdent(rest3)
    if (!second) return { schema: '', table: first }
    return { schema: first, table: second }
  }
  return { schema: '', table: first }
}

// -- Tag Index --

/** Holds extracted tags keyed by table and column names. */
export interface TagIndex {
  /** Table name -> tags. Keys are "table" or "schema.table". */
  tableTags: Map<string, Tag[]>
  /** "table.column" or "schema.table.column" -> tags. */
  columnTags: Map<string, Tag[]>
}

function tableKey(schemaName: string, tableName: string): string {
  return schemaName ? `${schemaName}.${tableName}` : tableName
}

function columnKey(schemaName: string, tableName: string, columnName: string): string {
  return schemaName ? `${schemaName}.${tableName}.${columnName}` : `${tableName}.${columnName}`
}

/** Extract all @-annotation tags from SQL Stmt objects. */
export function extractTagsFromStmts(stmtList: Stmt[]): TagIndex {
  const idx: TagIndex = {
    tableTags: new Map(),
    columnTags: new Map(),
  }

  for (const stmt of stmtList) {
    const { schema: sn, table: tn } = parseTableName(stmt.text)
    if (!tn) continue

    // Tags from comments before the statement.
    let tblTags = stmtTags(stmt)

    // Tags from inside the statement (inline table tags + column tags).
    const { columnTags: colTags, tableTags: inlineTT } = parseStmtTags(stmt.text)
    tblTags = [...tblTags, ...inlineTT]

    if (tblTags.length > 0) {
      const key = tableKey(sn, tn)
      const existing = idx.tableTags.get(key) ?? []
      existing.push(...tblTags)
      idx.tableTags.set(key, existing)
    }

    for (const [col, tags] of colTags) {
      const key = columnKey(sn, tn, col)
      const existing = idx.columnTags.get(key) ?? []
      existing.push(...tags)
      idx.columnTags.set(key, existing)
    }
  }

  return idx
}
