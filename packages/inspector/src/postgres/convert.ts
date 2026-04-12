// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/postgres/convert.go

import type { SchemaType } from '../schema/schema.ts'
import {
  TypeBigInt,
  TypeBigSerial,
  TypeBool,
  TypeBoolean,
  TypeBPChar,
  TypeChar,
  TypeCharacter,
  TypeCharVar,
  TypeDecimal,
  TypeDouble,
  TypeFloat,
  TypeFloat4,
  TypeFloat8,
  TypeInt,
  TypeInt2,
  TypeInt4,
  TypeInt8,
  TypeInteger,
  TypeName,
  TypeNumeric,
  TypeReal,
  TypeSerial,
  TypeSerial2,
  TypeSerial4,
  TypeSerial8,
  TypeSmallInt,
  TypeSmallSerial,
  TypeText,
  TypeTime,
  TypeTimestamp,
  TypeTimestampTZ,
  TypeTimestampWOTZ,
  TypeTimestampWTZ,
  TypeTimeTZ,
  TypeTimeWOTZ,
  TypeTimeWTZ,
  TypeVarChar,
  TypeXID,
  TypeXID8,
} from './driver.ts'

// -- Type Alias Mapping --

/**
 * Maps PostgreSQL type abbreviations/aliases to their canonical forms.
 * Used for equivalence comparison.
 */
const typeAliases: Record<string, string> = {
  int2: TypeSmallInt,
  int4: TypeInteger,
  int8: TypeBigInt,
  int: TypeInteger,
  float4: TypeReal,
  float8: TypeDouble,
  bool: TypeBoolean,
  varchar: TypeCharVar,
  char: TypeCharacter,
  bpchar: TypeCharacter,
  serial2: TypeSmallSerial,
  serial4: TypeSerial,
  serial8: TypeBigSerial,
  timestamptz: TypeTimestampTZ,
  'timestamp with time zone': TypeTimestampTZ,
  'timestamp without time zone': TypeTimestamp,
  timetz: TypeTimeTZ,
  'time with time zone': TypeTimeTZ,
  'time without time zone': TypeTime,
  decimal: TypeNumeric,
  xid: TypeXID,
  xid8: TypeXID8,
}

/**
 * Convert/normalize a PostgreSQL type name to its canonical form.
 * e.g., "int4" -> "integer", "int8" -> "bigint", "float8" -> "double precision"
 */
export function convertType(typeName: string): string {
  const lower = typeName.toLowerCase().trim()
  return typeAliases[lower] ?? lower
}

/**
 * Check if two PostgreSQL type names are equivalent.
 */
export function typesEquivalent(a: string, b: string): boolean {
  return convertType(a) === convertType(b)
}

/**
 * Normalize a column default expression for comparison.
 * Strips trailing type casts (e.g., "1::integer" -> "1") when they are
 * simple appended casts.
 */
export function normalizeDefault(expr: string | undefined, _typeName: string): string | undefined {
  if (expr === undefined) return undefined
  return trimCast(expr)
}

/** Strip a trailing ::type cast from an expression. */
function trimCast(s: string): string {
  const i = s.lastIndexOf('::')
  if (i === -1) return s
  // Verify the rest is a simple type reference (letters, digits, spaces, parens for precision)
  const rest = s.slice(i + 2)
  if (/^[a-zA-Z0-9_\s(),.]+$/.test(rest)) {
    return s.slice(0, i)
  }
  return s
}

/**
 * Convert a SchemaType to its PostgreSQL DDL string.
 * Follows the Go FormatType function in convert.go.
 */
export function typeDDL(t: SchemaType): string {
  switch (t.kind) {
    case 'integer': {
      const lower = t.T.toLowerCase()
      switch (lower) {
        case TypeInt2:
          return TypeSmallInt
        case TypeInt:
        case TypeInt4:
          return TypeInteger
        case TypeInt8:
          return TypeBigInt
        default:
          return lower
      }
    }

    case 'boolean': {
      const lower = t.T.toLowerCase()
      return lower === TypeBool ? TypeBoolean : lower
    }

    case 'float': {
      const lower = t.T.toLowerCase()
      switch (lower) {
        case TypeFloat4:
          return TypeReal
        case TypeFloat8:
          return TypeDouble
        case TypeFloat: {
          const prec = (t as any).precision ?? 0
          if (prec > 0 && prec <= 24) return TypeReal
          if (prec === 0 || (prec > 24 && prec <= 53)) return TypeDouble
          throw new Error(`postgres: precision for type float must be between 1 and 53: ${prec}`)
        }
        default:
          return lower
      }
    }

    case 'decimal': {
      const lower = t.T.toLowerCase()
      const base = lower === TypeDecimal ? TypeNumeric : lower
      const prec = (t as any).precision ?? 0
      const scale = (t as any).scale ?? 0
      if (prec === 0 && scale === 0) return base
      if (scale === 0) return `${base}(${prec})`
      return `${base}(${prec},${scale})`
    }

    case 'string': {
      const lower = t.T.toLowerCase()
      const size = (t as any).size ?? 0
      switch (lower) {
        case TypeText:
        case TypeBPChar:
        case TypeName:
          return lower
        case TypeChar:
        case TypeCharacter: {
          const n = size || 1
          return `${TypeCharacter}(${n})`
        }
        case TypeVarChar:
        case TypeCharVar: {
          if (size > 0) return `${TypeCharVar}(${size})`
          return TypeCharVar
        }
        default:
          return lower
      }
    }

    case 'time': {
      const lower = timeAlias(t.T)
      const prec = (t as any).precision
      if (prec !== undefined && prec !== null && prec !== 6 && lower.startsWith('time')) {
        return `${lower}(${prec})`
      }
      return lower
    }

    case 'interval': {
      let f = t.T.toLowerCase()
      const fields = (t as any).fields
      if (fields) f += ` ${fields.toLowerCase()}`
      const prec = (t as any).precision
      if (prec !== undefined && prec !== null && prec !== 6) {
        f += `(${prec})`
      }
      return f
    }

    case 'binary':
      return t.T.toLowerCase()

    case 'json':
      return t.T.toLowerCase()

    case 'uuid':
      return t.T.toLowerCase()

    case 'spatial':
      return t.T.toLowerCase()

    case 'network':
      return t.T.toLowerCase()

    case 'currency':
      return t.T.toLowerCase()

    case 'text_search':
      return t.T.toLowerCase()

    case 'enum': {
      if (!t.T) throw new Error('postgres: missing enum type name')
      return qualifyType(t.T, (t as any).schema)
    }

    case 'composite': {
      if (!t.T) throw new Error('postgres: missing composite type name')
      return qualifyType(t.T, (t as any).schema)
    }

    case 'domain': {
      if (!t.T) throw new Error('postgres: missing domain type name')
      return qualifyType(t.T, (t as any).schema)
    }

    case 'serial': {
      const lower = t.T.toLowerCase()
      switch (lower) {
        case TypeSerial2:
          return TypeSmallSerial
        case TypeSerial4:
          return TypeSerial
        case TypeSerial8:
          return TypeBigSerial
        default:
          return lower
      }
    }

    case 'array': {
      return t.T.toLowerCase()
    }

    case 'range': {
      return t.T.toLowerCase()
    }

    case 'unsupported':
      return t.T

    default:
      return (t as any).T ?? ''
  }
}

/** Normalize time type aliases. */
function timeAlias(t: string): string {
  const lower = t.toLowerCase()
  switch (lower) {
    case TypeTimestampWTZ:
    case 'timestamp with time zone':
      return TypeTimestampTZ
    case TypeTimestampWOTZ:
    case 'timestamp without time zone':
      return TypeTimestamp
    case TypeTimeWOTZ:
    case 'time without time zone':
      return TypeTime
    case TypeTimeWTZ:
    case 'time with time zone':
      return TypeTimeTZ
    default:
      return lower
  }
}

/**
 * Ensure a string is single-quoted for SQL.
 */
export function quote(s: string): string {
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s
  }
  return `'${s.replace(/'/g, "''")}'`
}

/** Schema-qualify a type name if it has a schema. */
function qualifyType(name: string, schema?: string): string {
  if (schema) return `"${schema}"."${name}"`
  return name
}
