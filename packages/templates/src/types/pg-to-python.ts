/** Category-based mapping — used when Atlas provides a type category */
const CATEGORY_TO_PYTHON: Record<string, string> = {
  string: 'str',
  integer: 'int',
  float: 'float',
  decimal: 'Decimal',
  boolean: 'bool',
  time: 'datetime',
  binary: 'bytes',
  json: 'dict',
  uuid: 'UUID',
  spatial: 'str',
  enum: 'str', // overridden per-column with actual enum type
  unknown: 'Any',
}

const PG_TO_PYTHON: Record<string, string> = {
  // Numeric
  smallint: 'int',
  int2: 'int',
  integer: 'int',
  int: 'int',
  int4: 'int',
  bigint: 'int',
  int8: 'int',
  serial: 'int',
  serial4: 'int',
  bigserial: 'int',
  serial8: 'int',
  smallserial: 'int',
  serial2: 'int',
  real: 'float',
  float4: 'float',
  'double precision': 'float',
  float8: 'float',
  numeric: 'Decimal',
  decimal: 'Decimal',
  money: 'Decimal',

  // String
  text: 'str',
  varchar: 'str',
  'character varying': 'str',
  char: 'str',
  character: 'str',
  name: 'str',
  citext: 'str',

  // Boolean
  boolean: 'bool',
  bool: 'bool',

  // Date/Time
  timestamp: 'datetime',
  'timestamp without time zone': 'datetime',
  timestamptz: 'datetime',
  'timestamp with time zone': 'datetime',
  date: 'date',
  time: 'time',
  'time without time zone': 'time',
  timetz: 'time',
  'time with time zone': 'time',
  interval: 'timedelta',

  // Binary
  bytea: 'bytes',

  // JSON
  json: 'dict',
  jsonb: 'dict',

  // UUID
  uuid: 'UUID',

  // Network
  inet: 'str',
  cidr: 'str',
  macaddr: 'str',
  macaddr8: 'str',
}

/**
 * Map a PostgreSQL type to a Python type annotation.
 * Nullable types use Optional[T].
 */
export function pgToPython(pgType: string, nullable: boolean, category?: string): string {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays
  if (normalized.endsWith('[]')) {
    const base = pgToPython(normalized.slice(0, -2), false)
    return wrapNullable(`list[${base}]`, nullable)
  }
  if (normalized.startsWith('_')) {
    const base = pgToPython(normalized.slice(1), false)
    return wrapNullable(`list[${base}]`, nullable)
  }

  // Strip length specifiers
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  // Try raw type lookup first for precise mapping
  let pyType = PG_TO_PYTHON[baseType]

  // Fall back to category-based mapping for unknown raw types
  if (pyType === undefined && category) {
    pyType = CATEGORY_TO_PYTHON[category]
  }

  if (pyType === undefined) {
    pyType = 'Any'
  }

  return wrapNullable(pyType, nullable)
}

function wrapNullable(type: string, nullable: boolean): string {
  if (!nullable) return type
  return `Optional[${type}]`
}
