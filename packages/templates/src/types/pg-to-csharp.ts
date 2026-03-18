// C# value types that support nullable with ? suffix
const _VALUE_TYPES = new Set([
  'short',
  'int',
  'long',
  'float',
  'double',
  'decimal',
  'bool',
  'DateTime',
  'DateTimeOffset',
  'DateOnly',
  'TimeOnly',
  'TimeSpan',
  'Guid',
])

/** Category-based mapping — used when Atlas provides a type category */
const CATEGORY_TO_CSHARP: Record<string, string> = {
  string: 'string',
  integer: 'long',
  float: 'double',
  decimal: 'decimal',
  boolean: 'bool',
  time: 'DateTime',
  binary: 'byte[]',
  json: 'string',
  uuid: 'Guid',
  spatial: 'string',
  enum: 'string', // overridden per-column with actual enum type
  unknown: 'string',
}

const PG_TO_CSHARP: Record<string, string> = {
  // Numeric
  smallint: 'short',
  int2: 'short',
  integer: 'int',
  int: 'int',
  int4: 'int',
  bigint: 'long',
  int8: 'long',
  serial: 'int',
  serial4: 'int',
  bigserial: 'long',
  serial8: 'long',
  smallserial: 'short',
  serial2: 'short',
  real: 'float',
  float4: 'float',
  'double precision': 'double',
  float8: 'double',
  numeric: 'decimal',
  decimal: 'decimal',
  money: 'decimal',

  // String
  text: 'string',
  varchar: 'string',
  'character varying': 'string',
  char: 'string',
  character: 'string',
  name: 'string',
  citext: 'string',

  // Boolean
  boolean: 'bool',
  bool: 'bool',

  // Date/Time
  timestamp: 'DateTime',
  'timestamp without time zone': 'DateTime',
  timestamptz: 'DateTimeOffset',
  'timestamp with time zone': 'DateTimeOffset',
  date: 'DateOnly',
  time: 'TimeOnly',
  'time without time zone': 'TimeOnly',
  timetz: 'TimeOnly',
  'time with time zone': 'TimeOnly',
  interval: 'TimeSpan',

  // Binary
  bytea: 'byte[]',

  // JSON
  json: 'string',
  jsonb: 'string',

  // UUID
  uuid: 'Guid',

  // Network
  inet: 'IPAddress',
  cidr: 'string',
  macaddr: 'string',
}

/**
 * Map a PostgreSQL type to a C# type string.
 * Nullable value types use ? suffix (int?), reference types use ? suffix (string?).
 */
export function pgToCsharp(pgType: string, nullable: boolean, category?: string): string {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays
  if (normalized.endsWith('[]')) {
    const base = pgToCsharp(normalized.slice(0, -2), false)
    return wrapNullable(`${base}[]`, nullable)
  }
  if (normalized.startsWith('_')) {
    const base = pgToCsharp(normalized.slice(1), false)
    return wrapNullable(`${base}[]`, nullable)
  }

  // Strip length specifiers
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  // Try raw type lookup first for precise mapping
  let csType = PG_TO_CSHARP[baseType]

  // Fall back to category-based mapping for unknown raw types
  if (csType === undefined && category) {
    csType = CATEGORY_TO_CSHARP[category]
  }

  if (csType === undefined) {
    csType = 'string'
  }

  return wrapNullable(csType, nullable)
}

function wrapNullable(type: string, nullable: boolean): string {
  if (!nullable) return type
  return `${type}?`
}
