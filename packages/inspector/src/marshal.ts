// Derived from Atlas by Atlas Authors, licensed under Apache 2.0

import type { SchemaType, TypeCategory } from './schema/schema.ts'

/**
 * Determine the TypeCategory for a SchemaType.
 * Maps the `kind` discriminant to the category enum.
 */
export function typeCategory(t: SchemaType): TypeCategory {
  switch (t.kind) {
    case 'string':
      return 'string'
    case 'integer':
      return 'integer'
    case 'float':
      return 'float'
    case 'decimal':
      return 'decimal'
    case 'boolean':
      return 'boolean'
    case 'time':
      return 'time'
    case 'binary':
      return 'binary'
    case 'json':
      return 'json'
    case 'uuid':
      return 'uuid'
    case 'spatial':
      return 'spatial'
    case 'enum':
      return 'enum'
    case 'composite':
      return 'composite'
    case 'array':
      return 'array'
    case 'serial':
      return 'integer' // serial maps to integer category
    case 'network':
      return 'string' // network types map to string category
    case 'currency':
      return 'decimal' // money maps to decimal
    case 'text_search':
      return 'string'
    case 'interval':
      return 'time'
    case 'domain':
      return 'unknown' // domain uses underlying type -- would need recursive resolution
    case 'range':
      return 'unknown'
    case 'unsupported':
      return 'unknown'
    default:
      return 'unknown'
  }
}

/**
 * Check if a type is user-defined (enum, composite, domain).
 */
export function isCustomType(t: SchemaType): boolean {
  return t.kind === 'enum' || t.kind === 'composite' || t.kind === 'domain'
}
