/**
 * Validates parsed tags against loaded namespace definitions.
 * Uses externally-provided SQL statements for AST info (adapter-based).
 */

import type { SqlStatement } from './ast/types.ts'
import type { AstInfo } from './blocks.ts'
import { buildBlocks, detectTarget, detectTargetFallback } from './blocks.ts'
import type { ParsedTag } from './parser.ts'
import { parseArgs } from './parser.ts'
import type { ArgType, TagDef, TagNamespace, ValidationContext } from './types.ts'

// ── Diagnostics ─────────────────────────────────────────────────────

export interface Diagnostic {
  message: string
  line: number
  startCol: number
  endCol: number
  severity: 'error' | 'warning' | 'info'
}

// Re-export for consumers
export type { AstInfo }
export { detectTarget, detectTargetFallback }

// ── Main validate ───────────────────────────────────────────────────

export function validate(
  tags: ParsedTag[],
  namespaces: Map<string, TagNamespace>,
  docText: string,
  stmts?: SqlStatement[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const docLines = docText.split('\n')
  const blocks = buildBlocks(tags, docText, docLines, stmts ?? [])

  for (const block of blocks) {
    for (const tag of block.tags) {
      const ns = namespaces.get(tag.namespace)
      if (!ns) {
        diagnostics.push({
          message: `Unknown namespace '@${tag.namespace}'`,
          line: tag.line,
          startCol: tag.namespaceStart - 1,
          endCol: tag.namespaceEnd,
          severity: 'error',
        })
        continue
      }

      let tagDef: TagDef | undefined
      if (tag.tag === null) {
        tagDef = ns.tags.$self
        if (!tagDef) {
          diagnostics.push({
            message: `Namespace '${tag.namespace}' cannot be used as a standalone tag (no $self defined)`,
            line: tag.line,
            startCol: tag.namespaceStart - 1,
            endCol: tag.namespaceEnd,
            severity: 'error',
          })
          continue
        }
      } else {
        tagDef = ns.tags[tag.tag]
        if (!tagDef) {
          diagnostics.push({
            message: `Unknown tag '${tag.tag}' in namespace '${tag.namespace}'`,
            line: tag.line,
            startCol: tag.tagStart,
            endCol: tag.tagEnd,
            severity: 'error',
          })
          continue
        }
      }

      // Validate target
      if (tagDef.targets && tagDef.targets.length > 0 && block.ast.target !== 'unknown') {
        if (!tagDef.targets.includes(block.ast.target)) {
          const label = tag.tag ? `@${tag.namespace}.${tag.tag}` : `@${tag.namespace}`
          diagnostics.push({
            message: `${label} cannot be used on a ${block.ast.target} (allowed: ${tagDef.targets.join(', ')})`,
            line: tag.line,
            startCol: tag.startCol,
            endCol: tag.endCol,
            severity: 'error',
          })
          continue
        }
      }

      // Validate arguments
      diagnostics.push(...validateArgs(tag, tagDef))

      // Run custom validation function
      if (tagDef.validate) {
        try {
          const parsedArgs = tag.rawArgs !== null ? parseArgs(tag.rawArgs) : null
          const fileTags = blocks.map((b) => ({
            objectName: b.ast.objectName ?? 'unknown',
            target: b.ast.target,
            tags: b.tags.map((t) => ({ namespace: t.namespace, tag: t.tag, rawArgs: t.rawArgs })),
          }))
          const ctx: ValidationContext = {
            target: block.ast.target,
            lines: block.sqlLines,
            siblingTags: block.tags
              .filter((t) => t !== tag)
              .map((t) => ({ namespace: t.namespace, tag: t.tag, rawArgs: t.rawArgs })),
            fileTags,
            argValues: parsedArgs ? (parsedArgs.type === 'named' ? parsedArgs.values : parsedArgs.values) : {},
            columnName: block.ast.columnName,
            columnType: block.ast.columnType,
            objectName: block.ast.objectName,
            astNode: block.ast.astNode,
          }
          const result = tagDef.validate(ctx)
          if (result) {
            const message = typeof result === 'string' ? result : result.message
            const severity = typeof result === 'string' ? 'error' : (result.severity ?? 'error')
            diagnostics.push({
              message,
              line: tag.line,
              startCol: tag.startCol,
              endCol: tag.endCol,
              severity,
            })
          }
        } catch (err: any) {
          diagnostics.push({
            message: `Validation error: ${err?.message ?? err}`,
            line: tag.line,
            startCol: tag.startCol,
            endCol: tag.endCol,
            severity: 'error',
          })
        }
      }
    }
  }

  return diagnostics
}

// ── Arg validation ──────────────────────────────────────────────────

function validateArgs(tag: ParsedTag, def: TagDef): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const hasArgsDef = def.args !== undefined

  if (tag.rawArgs === null) {
    if (hasArgsDef && !Array.isArray(def.args)) {
      const namedDef = def.args as Record<string, ArgType & { required?: boolean }>
      const required = Object.entries(namedDef).filter(([, v]) => (v as any).required)
      if (required.length > 0) {
        diagnostics.push({
          message: `Missing required argument(s): ${required.map(([k]) => k).join(', ')}`,
          line: tag.line,
          startCol: tag.startCol,
          endCol: tag.endCol,
          severity: 'error',
        })
      }
    }
    return diagnostics
  }

  if (!hasArgsDef) {
    diagnostics.push({
      message: `Tag '${tag.tag ?? tag.namespace}' does not accept arguments`,
      line: tag.line,
      startCol: tag.argsStart - 1,
      endCol: tag.argsEnd + 1,
      severity: 'error',
    })
    return diagnostics
  }

  const parsed = parseArgs(tag.rawArgs)

  if (Array.isArray(def.args)) {
    validatePositionalArgs(tag, def as { args: ArgType[] }, parsed, diagnostics)
  } else {
    validateNamedArgs(tag, def as { args: Record<string, ArgType & { required?: boolean }> }, parsed, diagnostics)
  }

  return diagnostics
}

function validatePositionalArgs(
  tag: ParsedTag,
  def: { args: ArgType[] },
  parsed: ReturnType<typeof parseArgs>,
  diagnostics: Diagnostic[],
) {
  if (parsed.type === 'named') {
    diagnostics.push({
      message: `Tag '${tag.tag ?? tag.namespace}' expects positional arguments, not named`,
      line: tag.line,
      startCol: tag.argsStart,
      endCol: tag.argsEnd,
      severity: 'error',
    })
    return
  }

  if (parsed.values.length > def.args.length) {
    diagnostics.push({
      message: `Too many arguments: expected at most ${def.args.length}, got ${parsed.values.length}`,
      line: tag.line,
      startCol: tag.argsStart,
      endCol: tag.argsEnd,
      severity: 'error',
    })
    return
  }

  for (let i = 0; i < parsed.values.length; i++) {
    const typeError = checkType(parsed.values[i], def.args[i])
    if (typeError) {
      diagnostics.push({
        message: typeError,
        line: tag.line,
        startCol: tag.argsStart,
        endCol: tag.argsEnd,
        severity: 'error',
      })
    }
  }
}

function validateNamedArgs(
  tag: ParsedTag,
  def: { args: Record<string, ArgType & { required?: boolean }> },
  parsed: ReturnType<typeof parseArgs>,
  diagnostics: Diagnostic[],
) {
  if (parsed.type === 'positional' && parsed.values.length > 0) {
    diagnostics.push({
      message: `Tag '${tag.tag ?? tag.namespace}' expects named arguments (key: value)`,
      line: tag.line,
      startCol: tag.argsStart,
      endCol: tag.argsEnd,
      severity: 'error',
    })
    return
  }

  const values = parsed.type === 'named' ? parsed.values : {}

  // If args definition is empty, accept any named args (dynamic keys)
  const acceptsAnyKeys = Object.keys(def.args).length === 0

  if (!acceptsAnyKeys) {
    for (const key of Object.keys(values)) {
      if (!(key in def.args)) {
        diagnostics.push({
          message: `Unknown argument '${key}'`,
          line: tag.line,
          startCol: tag.argsStart,
          endCol: tag.argsEnd,
          severity: 'error',
        })
      }
    }
  }

  for (const [key, argDef] of Object.entries(def.args)) {
    const value = values[key]
    if (value === undefined) {
      if ((argDef as any).required) {
        diagnostics.push({
          message: `Missing required argument '${key}'`,
          line: tag.line,
          startCol: tag.argsStart,
          endCol: tag.argsEnd,
          severity: 'error',
        })
      }
      continue
    }
    const typeError = checkType(value, argDef)
    if (typeError) {
      diagnostics.push({
        message: `Argument '${key}': ${typeError}`,
        line: tag.line,
        startCol: tag.argsStart,
        endCol: tag.argsEnd,
        severity: 'error',
      })
    }
  }
}

function checkType(value: unknown, argType: ArgType): string | undefined {
  switch (argType.type) {
    case 'string':
      if (typeof value !== 'string') return `expected string, got ${typeof value}`
      return undefined
    case 'number':
      if (typeof value !== 'number') return `expected number, got ${typeof value}`
      return undefined
    case 'boolean':
      if (typeof value !== 'boolean') return `expected boolean, got ${typeof value}`
      return undefined
    case 'enum':
      if (!argType.values.includes(String(value))) {
        return `expected one of [${argType.values.join(', ')}], got '${value}'`
      }
      return undefined
    case 'array':
      if (!Array.isArray(value)) return `expected array, got ${typeof value}`
      for (let i = 0; i < value.length; i++) {
        const err = checkType(value[i], argType.items)
        if (err) return `element ${i}: ${err}`
      }
      return undefined
    default:
      return undefined
  }
}
