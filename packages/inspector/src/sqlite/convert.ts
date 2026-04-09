// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/sqlite/convert.go

import type { SchemaType } from '../schema/schema.ts'

/**
 * Format a SchemaType to its SQLite column type string.
 * SQLite types are lowercased due to SQLite's flexibility with type affinity.
 * See: https://www.sqlite.org/datatype3.html
 */
export function formatType(t: SchemaType): string {
  switch (t.kind) {
    case 'boolean':
    case 'binary':
    case 'integer':
    case 'string':
    case 'time':
    case 'float':
    case 'decimal':
    case 'json':
    case 'spatial':
    case 'uuid':
      return t.T.toLowerCase()
    case 'enum':
      return t.T
    case 'unsupported':
      throw new Error(`sqlite: unsupported type: "${t.T}"`)
    default:
      throw new Error(`sqlite: invalid schema type: ${t.kind}`)
  }
}

/**
 * Convert a raw type name to its canonical SQLite form.
 * This is an alias for formatType after parsing.
 */
export function convertType(typeName: string): string {
  return typeName.toLowerCase().trim()
}

/**
 * Generate the DDL type string for a SchemaType.
 * For types with precision/scale (decimal) or size (string), includes parameters.
 */
export function typeDDL(t: SchemaType): string {
  const base = t.T.toLowerCase()
  switch (t.kind) {
    case 'decimal': {
      if (t.precision != null && t.scale != null) {
        return `${base}(${t.precision},${t.scale})`
      }
      if (t.precision != null) {
        return `${base}(${t.precision})`
      }
      return base
    }
    case 'string': {
      if (t.size != null) {
        return `${base}(${t.size})`
      }
      return base
    }
    default:
      return base
  }
}
