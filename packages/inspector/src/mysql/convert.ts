// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/mysql/convert.go

import { isQuoted } from '../internal/sqlx.ts'
import type { SchemaType } from '../schema/schema.ts'
import {
  TypeBinary,
  TypeBit,
  TypeBool,
  TypeBoolean,
  TypeChar,
  TypeDecimal,
  TypeDouble,
  TypeFloat,
  TypeInt,
  TypeNumeric,
  TypeReal,
  TypeSet,
  TypeTinyInt,
  TypeVarBinary,
  TypeVarchar,
} from './driver.ts'

/**
 * Convert a schema type name to its canonical MySQL form.
 * Maps aliases to their canonical type names.
 */
export function convertType(typeName: string): string {
  const lower = typeName.toLowerCase().trim()
  switch (lower) {
    case 'boolean':
    case TypeBool:
    case 'tinyint(1)':
      return TypeBool
    case 'integer':
      return TypeInt
    case TypeReal:
      return TypeDouble
    default:
      return lower
  }
}

/**
 * Reports if two MySQL type names are equivalent (considering aliases).
 */
export function typesEquivalent(a: string, b: string): boolean {
  return convertType(a) === convertType(b)
}

/**
 * Format a SchemaType to its MySQL DDL representation.
 * An error is thrown if the type cannot be recognized.
 */
export function typeDDL(t: SchemaType): string {
  switch (t.kind) {
    case 'boolean': {
      const lower = t.T.toLowerCase()
      switch (lower) {
        case TypeBool:
        case TypeBoolean:
        case TypeTinyInt:
        case 'tinyint(1)':
          return TypeBool
        default:
          return TypeBool
      }
    }

    case 'integer': {
      let f = t.T.toLowerCase()
      if (t.unsigned) f += ' unsigned'
      return f
    }

    case 'float': {
      let f = t.T.toLowerCase()
      // FLOAT with precision > 24 becomes DOUBLE
      // REAL is synonym for DOUBLE
      if ((f === TypeFloat && t.precision && t.precision > 24) || f === TypeReal) {
        f = TypeDouble
      }
      if (t.T.toLowerCase() === TypeFloat && t.precision && t.precision > 24) {
        f = TypeDouble
      }
      return f
    }

    case 'decimal': {
      const f = t.T.toLowerCase()
      if (f !== TypeDecimal && f !== TypeNumeric) {
        throw new Error(`unexpected decimal type: "${t.T}"`)
      }
      const p = t.precision ?? 0
      const s = t.scale ?? 0
      if (p < 0 || s < 0) {
        throw new Error(`decimal type must have precision > 0 and scale >= 0: ${p}, ${s}`)
      }
      if (p > 0 && p < s) {
        throw new Error(`decimal type must have precision >= scale: ${p} < ${s}`)
      }
      const prec = p === 0 ? 10 : p
      if (s === 0) return `decimal(${prec})`
      return `decimal(${prec},${s})`
    }

    case 'string': {
      const f = t.T.toLowerCase()
      switch (f) {
        case TypeChar:
          if (t.size && t.size > 0) return `${f}(${t.size})`
          return f
        case TypeVarchar:
          return `varchar(${t.size ?? 0})`
        default:
          return f
      }
    }

    case 'binary': {
      const f = t.T.toLowerCase()
      switch (f) {
        case TypeBit:
          if (t.size && t.size > 1) return `bit(${t.size})`
          return 'bit'
        case TypeVarBinary:
          if (t.size != null) return `${f}(${t.size})`
          return f
        case TypeBinary:
          if (t.size != null && t.size !== 1) return `${f}(${t.size})`
          return f
        default:
          return f
      }
    }

    case 'time': {
      const f = t.T.toLowerCase()
      if (t.precision != null && t.precision > 0) {
        return `${f}(${t.precision})`
      }
      return f
    }

    case 'json':
      return t.T.toLowerCase()

    case 'enum': {
      const values = (t.values ?? []).map((v) => {
        if (isQuoted(v, '"', "'")) return v
        return `'${v}'`
      })
      if (t.T === TypeSet) {
        return `set(${values.join(',')})`
      }
      return `enum(${values.join(',')})`
    }

    case 'spatial':
      return t.T.toLowerCase()

    case 'uuid':
      return t.T.toLowerCase()

    case 'unsupported':
      throw new Error(`unsupported type "${t.T}"`)

    default:
      throw new Error(`invalid schema type kind: ${(t as any).kind}`)
  }
}

/**
 * Format ENUM and SET values for DDL.
 */
export function formatValues(vs: string[]): string {
  return vs
    .map((v) => {
      if (isQuoted(v, '"', "'")) return v
      return `'${v}'`
    })
    .join(',')
}
