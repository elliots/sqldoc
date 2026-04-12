import type { Expr, SchemaType } from '../schema/schema.ts'
import {
  TypeDecimal,
  TypeFloat,
  TypeNumeric,
  TypeNVarchar,
  TypeReal,
  TypeRowVersion,
  TypeSysname,
  TypeTimestamp,
  typeHasMaxLength,
  typeHasScale,
} from './driver.ts'

// -- Type Alias Mapping --

/**
 * Maps MSSQL type aliases to their canonical forms.
 * Used for equivalence comparison between schema types.
 */
const typeAliases: Record<string, string> = {
  sysname: `${TypeNVarchar}(128)`,
  timestamp: TypeRowVersion,
  rowversion: TypeRowVersion,
  'float(53)': TypeFloat,
  'float(24)': TypeReal,
  real: TypeReal,
}

// -- Type Equivalence --

/**
 * Check if two MSSQL SchemaTypes are equivalent, accounting for MSSQL type aliases.
 * Handles: sysname = nvarchar(128), timestamp = rowversion, float(53) = float,
 * real = float(24), decimal with default precision (18,0).
 */
export function typesEquivalent(a: SchemaType, b: SchemaType): boolean {
  const na = normalizeTypeString(a)
  const nb = normalizeTypeString(b)
  return na === nb
}

/**
 * Produce a normalized string representation of a SchemaType for comparison.
 * Resolves aliases and default precisions so equivalent types compare equal.
 */
function normalizeTypeString(t: SchemaType): string {
  const raw = formatSchemaType(t).toLowerCase()
  return typeAliases[raw] ?? raw
}

/**
 * Format a SchemaType to its MSSQL DDL string, including size/precision qualifiers.
 */
function formatSchemaType(t: SchemaType): string {
  const base = t.T.toLowerCase()

  switch (t.kind) {
    case 'string': {
      const size = (t as any).size as number | undefined
      if (base === TypeSysname) return TypeSysname
      if (typeHasMaxLength(base)) {
        if (size === -1) return `${base}(max)`
        if (size && size > 0) return `${base}(${size})`
      }
      return base
    }

    case 'integer':
      return base

    case 'boolean':
      return base

    case 'float': {
      const prec = (t as any).precision as number | undefined
      if (base === TypeReal) return TypeReal
      if (base === TypeFloat) {
        if (!prec || prec === 53) return TypeFloat
        if (prec === 24) return TypeReal
        return `${TypeFloat}(${prec})`
      }
      return base
    }

    case 'decimal': {
      const prec = (t as any).precision as number | undefined
      const scale = (t as any).scale as number | undefined
      // decimal/numeric with default precision (18,0) or no precision are equivalent
      if (base === TypeDecimal || base === TypeNumeric) {
        if (!prec && !scale) return `${TypeDecimal}(18,0)`
        if (prec && !scale) return `${TypeDecimal}(${prec},0)`
        if (prec && scale) return `${TypeDecimal}(${prec},${scale})`
        return `${TypeDecimal}(18,0)`
      }
      return base
    }

    case 'time': {
      if (typeHasScale(base)) {
        const prec = (t as any).precision as number | undefined
        if (prec && prec > 0) return `${base}(${prec})`
      }
      return base
    }

    case 'binary': {
      const size = (t as any).size as number | undefined
      if (base === TypeRowVersion || base === TypeTimestamp) return TypeRowVersion
      if (typeHasMaxLength(base)) {
        if (size === -1) return `${base}(max)`
        if (size && size > 0) return `${base}(${size})`
      }
      return base
    }

    default:
      return base
  }
}

// -- Default Normalization --

/**
 * Normalize an MSSQL column default expression for comparison.
 * MSSQL wraps defaults in extra parentheses: ((0)), (getdate()), (N'text').
 * This strips the outermost layer of parentheses if present.
 */
export function normalizeDefault(def: string | undefined): string | undefined {
  if (def === undefined || def === '') return undefined
  return stripOuterParens(def)
}

/**
 * Strip the outermost layer of parentheses from an MSSQL default expression.
 * MSSQL stores defaults like ((0)), ((1)), (getdate()), (N'hello').
 * Repeatedly strips one outer pair until no more can be removed without
 * breaking the inner expression.
 */
function stripOuterParens(s: string): string {
  let result = s.trim()
  // Strip one layer of outer parens if present and balanced
  while (result.length >= 2 && result[0] === '(' && result[result.length - 1] === ')') {
    const inner = result.slice(1, -1)
    // Make sure the inner string has balanced parens
    if (!isBalanced(inner)) break
    result = inner
  }
  return result
}

/** Check if parentheses are balanced in a string. */
function isBalanced(s: string): boolean {
  let depth = 0
  let inString = false
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (ch === quote) {
        // Check for escaped quote
        if (i + 1 < s.length && s[i + 1] === quote) {
          i++
        } else {
          inString = false
        }
      }
    } else if (ch === "'" || ch === '"') {
      inString = true
      quote = ch
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}

// -- Default Classification --

/**
 * Classify an MSSQL default expression as a Literal or RawExpr.
 * After stripping outer parentheses, determines whether the value is a
 * simple literal (number, quoted string, N'string') or a raw expression
 * (function call, keyword like NULL, etc.).
 */
export function classifyDefault(def: string): Expr {
  const stripped = stripOuterParens(def)
  if (stripped === '') return { V: '' }

  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(stripped)) {
    return { V: stripped }
  }

  // Quoted string literal: 'value' or N'value'
  if (/^N?'[\s\S]*'$/.test(stripped)) {
    return { V: stripped }
  }

  // Everything else is a raw expression (function calls, keywords, etc.)
  return { X: stripped }
}

// -- Type DDL Formatting --

/**
 * Format a SchemaType to its MSSQL DDL string representation.
 * Used when generating CREATE TABLE / ALTER COLUMN statements.
 */
export function typeDDL(t: SchemaType): string {
  const base = t.T.toLowerCase()

  switch (t.kind) {
    case 'boolean':
      return base

    case 'integer':
      return base

    case 'float': {
      const prec = (t as any).precision as number | undefined
      if (base === TypeReal) return TypeReal
      if (base === TypeFloat) {
        // float without precision or float(53) — just 'float'
        if (!prec || prec === 53) return TypeFloat
        return `${TypeFloat}(${prec})`
      }
      return base
    }

    case 'decimal': {
      const prec = (t as any).precision as number | undefined
      const scale = (t as any).scale as number | undefined
      if (base !== TypeDecimal && base !== TypeNumeric) return base
      if (!prec && !scale) return base
      if (prec && !scale) return `${base}(${prec})`
      if (prec && scale) return `${base}(${prec},${scale})`
      return base
    }

    case 'string': {
      const size = (t as any).size as number | undefined
      if (base === TypeSysname) return TypeSysname
      if (typeHasMaxLength(base)) {
        if (size === -1) return `${base}(max)`
        if (size && size > 0) return `${base}(${size})`
      }
      return base
    }

    case 'time': {
      const prec = (t as any).precision as number | undefined
      if (typeHasScale(base)) {
        if (prec != null && prec > 0) return `${base}(${prec})`
      }
      return base
    }

    case 'binary': {
      const size = (t as any).size as number | undefined
      if (base === TypeRowVersion || base === TypeTimestamp) return TypeRowVersion
      if (typeHasMaxLength(base)) {
        if (size === -1) return `${base}(max)`
        if (size && size > 0) return `${base}(${size})`
      }
      return base
    }

    case 'uuid':
      return base

    case 'spatial':
      return base

    case 'json':
      return base

    case 'unsupported':
      return t.T

    default:
      return t.T
  }
}

// -- SQL String Quoting --

/**
 * Ensure a string is single-quoted for MSSQL SQL.
 */
export function quote(s: string): string {
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s
  }
  return `'${s.replace(/'/g, "''")}'`
}
