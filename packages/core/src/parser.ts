/**
 * Parses SQL files for @import statements and @tags in comments.
 */

export interface ImportStatement {
  path: string
  line: number
  startCol: number
  endCol: number
}

export interface ParsedTag {
  namespace: string
  tag: string | null // null when namespace used as standalone (e.g. @searchable)
  rawArgs: string | null // raw string inside parens, null if no parens
  line: number
  startCol: number
  endCol: number
  // sub-ranges for precise squiggles
  namespaceStart: number
  namespaceEnd: number
  tagStart: number
  tagEnd: number
  argsStart: number
  argsEnd: number
}

export interface ParseResult {
  imports: ImportStatement[]
  tags: ParsedTag[]
}

const IMPORT_RE = /--\s*@import\s+(['"])([^'"]+)\1/g
const TAG_RE = /@(\w+)(?:\.(\w+))?(?:\(([^()]*(?:\([^()]*\)[^()]*)*)\))?/g

export function parse(text: string): ParseResult {
  const imports: ImportStatement[] = []
  const tags: ParsedTag[] = []
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Parse imports
    IMPORT_RE.lastIndex = 0
    let m: RegExpExecArray | null
    let isImportLine = false
    while ((m = IMPORT_RE.exec(line)) !== null) {
      imports.push({
        path: m[2],
        line: i,
        startCol: m.index,
        endCol: m.index + m[0].length,
      })
      isImportLine = true
    }
    if (isImportLine) continue

    // Find the comment portion of the line (if any)
    // Supports both full comment lines (-- ...) and inline comments (SQL -- ...)
    const commentIdx = line.indexOf('--')
    if (commentIdx < 0) continue

    TAG_RE.lastIndex = 0
    while ((m = TAG_RE.exec(line)) !== null) {
      const fullMatch = m[0]
      const namespace = m[1]
      const tag = m[2] || null
      const rawArgs = m[3] !== undefined ? m[3] : null

      // Skip @import — handled separately
      if (namespace === 'import') continue

      const nsStart = m.index + 1 // after @
      const nsEnd = nsStart + namespace.length

      let tStart = nsEnd
      let tEnd = nsEnd
      if (tag) {
        tStart = nsEnd + 1 // after .
        tEnd = tStart + tag.length
      }

      let aStart = 0
      let aEnd = 0
      if (rawArgs !== null) {
        aStart = m.index + fullMatch.indexOf('(') + 1
        aEnd = aStart + rawArgs.length
      }

      tags.push({
        namespace,
        tag,
        rawArgs,
        line: i,
        startCol: m.index,
        endCol: m.index + fullMatch.length,
        namespaceStart: nsStart,
        namespaceEnd: nsEnd,
        tagStart: tStart,
        tagEnd: tEnd,
        argsStart: aStart,
        argsEnd: aEnd,
      })
    }
  }

  return { imports, tags }
}

// ── Arg value parser ─────────────────────────────────────────────────

export type ArgValue = string | number | boolean | ArgValue[]

export interface NamedArgValues {
  type: 'named'
  values: Record<string, ArgValue>
}

export interface PositionalArgValues {
  type: 'positional'
  values: ArgValue[]
}

export type ParsedArgs = NamedArgValues | PositionalArgValues

/**
 * Parse the raw arg string from inside parens.
 * Detects whether args are named (key: value) or positional.
 */
export function parseArgs(raw: string): ParsedArgs {
  const trimmed = raw.trim()
  if (!trimmed) return { type: 'positional', values: [] }

  // Check if it looks like named args (contains "key:")
  if (/^\w+\s*:/.test(trimmed)) {
    return { type: 'named', values: parseNamedArgs(trimmed) }
  }

  // Positional
  return { type: 'positional', values: parsePositionalArgs(trimmed) }
}

function parseNamedArgs(raw: string): Record<string, ArgValue> {
  const result: Record<string, ArgValue> = {}
  // Match key: value pairs, where value can be a string, array, or bare word
  const NAMED_RE = /(\w+)\s*:\s*(\[(?:[^\]]*)\]|'[^']*'|"[^"]*"|\w+)/g
  let m: RegExpExecArray | null
  while ((m = NAMED_RE.exec(raw)) !== null) {
    result[m[1]] = parseValue(m[2])
  }
  return result
}

function parsePositionalArgs(raw: string): ArgValue[] {
  // Split by comma, respecting brackets and quoted strings
  const parts: string[] = []
  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let current = ''
  for (const ch of raw) {
    if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '[') depth++
      else if (ch === ']') depth--
      else if (ch === "'") inSingleQuote = true
      else if (ch === '"') inDoubleQuote = true
      else if (ch === ',' && depth === 0) {
        parts.push(current.trim())
        current = ''
        continue
      }
    } else if (inSingleQuote && ch === "'") {
      inSingleQuote = false
    } else if (inDoubleQuote && ch === '"') {
      inDoubleQuote = false
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts.map((s) => parseValue(s))
}

function parseValue(raw: string): ArgValue {
  // Array
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((s) => parseValue(s.trim()))
  }
  // Quoted string
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, -1)
  }
  // Number
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  // Boolean
  if (raw === 'true') return true
  if (raw === 'false') return false
  // Bare word (treated as string, e.g. enum value)
  return raw
}
