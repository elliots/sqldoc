/**
 * Shared block-building logic used by both validator and compiler.
 * Groups consecutive tag comments into blocks and resolves their SQL target
 * using span-based line matching from the AST.
 */

import type { SqlColumn, SqlStatement } from './ast/types.ts'
import { debug } from './debug.ts'
import type { ParsedTag } from './parser.ts'
import type { SqlTarget } from './types.ts'

// ── AST info ────────────────────────────────────────────────────────

export interface AstInfo {
  target: SqlTarget
  columnName?: string
  columnType?: string
  objectName?: string
  astNode?: unknown
}

export interface TagBlock {
  tags: ParsedTag[]
  sqlLines: string[]
  ast: AstInfo
}

/**
 * Simple text-based target detection for use where AST is unavailable.
 * Used by the VSCode extension's completion provider to filter suggestions
 * by target type (table, column, etc.) without requiring schema inspection.
 */
export function detectTarget(sqlLines: string[]): SqlTarget {
  if (sqlLines.length === 0) return 'unknown'
  const first = sqlLines[0]
  const TARGET_PATTERNS: [RegExp, SqlTarget][] = [
    [/^\s*CREATE\s+(OR\s+REPLACE\s+)?TABLE\b/i, 'table'],
    [/^\s*CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i, 'function'],
    [/^\s*CREATE\s+(OR\s+REPLACE\s+)?VIEW\b/i, 'view'],
    [/^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/i, 'index'],
    [/^\s*CREATE\s+TYPE\b/i, 'type'],
    [/^\s*CREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i, 'trigger'],
  ]
  for (const [re, target] of TARGET_PATTERNS) {
    if (re.test(first)) return target
  }
  if (/^\s+\w+\s+\w+/.test(first) && !first.trim().startsWith('CREATE')) {
    return 'column'
  }
  return 'unknown'
}

// ── Block building ──────────────────────────────────────────────────

/** Check if a tag is an inline comment (SQL code before the -- on the same line) */
function isInlineTag(tag: ParsedTag, docLines: string[]): boolean {
  const line = docLines[tag.line]
  if (!line) return false
  const commentIdx = line.indexOf('--')
  if (commentIdx < 0) return false
  // If there's non-whitespace before the --, it's inline
  return line.substring(0, commentIdx).trim().length > 0
}

export function buildBlocks(
  tags: ParsedTag[],
  _docText: string,
  docLines: string[],
  stmts: SqlStatement[],
): TagBlock[] {
  if (tags.length === 0) return []
  debug('blocks', `buildBlocks: ${tags.length} tag(s), ${stmts.length} statement(s)`)

  const blocks: TagBlock[] = []
  let currentTags: ParsedTag[] = []
  let lastTagLine = -2

  for (const tag of tags) {
    // Inline tags (comment after SQL on the same line) are always their own block
    if (isInlineTag(tag, docLines)) {
      if (currentTags.length > 0) {
        blocks.push(finalizeBlock(currentTags, docLines, stmts))
        currentTags = []
      }
      blocks.push(finalizeBlock([tag], docLines, stmts, true))
      lastTagLine = tag.line
      continue
    }

    if (currentTags.length > 0 && tag.line !== lastTagLine && tag.line !== lastTagLine + 1) {
      blocks.push(finalizeBlock(currentTags, docLines, stmts))
      currentTags = []
    }
    if (currentTags.length > 0 && tag.line === lastTagLine) {
      currentTags.push(tag)
    } else {
      if (currentTags.length > 0 && tag.line !== lastTagLine + 1) {
        blocks.push(finalizeBlock(currentTags, docLines, stmts))
        currentTags = []
      }
      currentTags.push(tag)
    }
    lastTagLine = tag.line
  }

  if (currentTags.length > 0) {
    blocks.push(finalizeBlock(currentTags, docLines, stmts))
  }

  return blocks
}

function finalizeBlock(tags: ParsedTag[], docLines: string[], stmts: SqlStatement[], inline = false): TagBlock {
  const lastTagLine = tags[tags.length - 1].line
  const firstTagLine = tags[0].line

  // Collect SQL lines
  const sqlLines: string[] = []
  if (inline) {
    // For inline tags, the SQL is the non-comment portion of the same line
    const line = docLines[lastTagLine]
    const commentIdx = line.indexOf('--')
    if (commentIdx > 0) {
      sqlLines.push(line.substring(0, commentIdx).trim())
    }
  }

  // Also collect SQL lines after the tag block (for non-inline, or as fallback)
  if (!inline) {
    for (let i = lastTagLine + 1; i < docLines.length; i++) {
      const line = docLines[i].trim()
      if (!line) continue
      if (line.startsWith('--')) continue
      sqlLines.push(docLines[i])
      if (line.endsWith(';') || line.endsWith(',') || line.endsWith(');') || line === ')') break
      if (/\$\$\s*$/.test(line)) {
        for (let j = i + 1; j < docLines.length; j++) {
          sqlLines.push(docLines[j])
          if (/\$\$/.test(docLines[j]) && j !== i) break
        }
        break
      }
    }
  }

  // Tags use 0-based lines, AST uses 1-based lines
  // A tag on line N (0-based) associates with the AST node on line N+1 or N+2 (1-based)
  const tagLine1Based = firstTagLine + 1

  const ast = resolveAstByLine(tagLine1Based, lastTagLine + 1, stmts, sqlLines)
  return { tags, sqlLines, ast }
}

/**
 * Match a tag block to an AST node using line numbers.
 *
 * Algorithm:
 * 1. If there's a column/statement on the same line as the tag (inline), use it
 * 2. Otherwise scan forward from the tag line:
 *    - Hit a column → related to that column
 *    - Hit a CREATE statement → related to that statement
 *    - Hit end-of-table (no more columns, past last column) → related to the table
 * 3. If no match found, return target 'unknown'.
 */
function resolveAstByLine(
  _firstTagLine: number, // 1-based
  lastTagLine: number, // 1-based
  stmts: SqlStatement[],
  _sqlLines: string[],
): AstInfo {
  if (stmts.length === 0) {
    return { target: 'unknown' }
  }

  // Build a flat list of all AST nodes (statements + columns) sorted by line
  type AstNode = { type: 'stmt'; stmt: SqlStatement } | { type: 'col'; col: SqlColumn; parentStmt: SqlStatement }

  const nodes: { line: number; node: AstNode }[] = []
  for (const stmt of stmts) {
    nodes.push({ line: stmt.line, node: { type: 'stmt', stmt } })
    for (const col of stmt.columns) {
      nodes.push({ line: col.line, node: { type: 'col', col, parentStmt: stmt } })
    }
  }
  nodes.sort((a, b) => a.line - b.line)

  // 1. Check for inline: a node on the same line as the tag, before it in text
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].line === lastTagLine) {
      return astInfoFromNode(nodes[i].node)
    }
    if (nodes[i].line < lastTagLine) break
  }

  // 2. Scan forward from the tag line — find the first node after the tag
  for (const entry of nodes) {
    if (entry.line > lastTagLine) {
      return astInfoFromNode(entry.node)
    }
  }

  // 3. Tag is after all nodes — find the enclosing table (if any)
  // Walk backwards to find the last table statement
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i].node
    if (n.type === 'stmt' && n.stmt.kind === 'table') {
      return {
        target: 'table',
        objectName: n.stmt.name,
        astNode: n.stmt.node,
      }
    }
    if (n.type === 'col') {
      // We're after the last field of this object — object-level
      return {
        target: n.parentStmt.kind,
        objectName: n.parentStmt.name,
        astNode: n.parentStmt.node,
      }
    }
  }

  return { target: 'unknown' }
}

function astInfoFromNode(
  node: { type: 'stmt'; stmt: SqlStatement } | { type: 'col'; col: SqlColumn; parentStmt: SqlStatement },
): AstInfo {
  if (node.type === 'col') {
    return {
      target: 'column',
      columnName: node.col.name,
      columnType: node.col.type,
      objectName: node.parentStmt.name,
      astNode: node.parentStmt.node,
    }
  }
  return {
    target: node.stmt.kind,
    objectName: node.stmt.name,
    astNode: node.stmt.node,
  }
}
