/** Category-based mapping — used when Atlas provides a type category */
const CATEGORY_TO_SWIFT: Record<string, string> = {
  string: 'String',
  integer: 'Int',
  float: 'Double',
  decimal: 'Decimal',
  boolean: 'Bool',
  time: 'Date',
  binary: 'Data',
  json: 'String',
  uuid: 'UUID',
  spatial: 'String',
  enum: 'String',
  unknown: 'Any',
}

const PG_TO_SWIFT: Record<string, string> = {
  // Numeric
  smallint: 'Int16',
  int2: 'Int16',
  integer: 'Int',
  int: 'Int',
  int4: 'Int',
  bigint: 'Int64',
  int8: 'Int64',
  serial: 'Int',
  serial4: 'Int',
  bigserial: 'Int64',
  serial8: 'Int64',
  smallserial: 'Int16',
  serial2: 'Int16',
  real: 'Float',
  float4: 'Float',
  'double precision': 'Double',
  float8: 'Double',
  numeric: 'Decimal',
  decimal: 'Decimal',
  money: 'Decimal',

  // String
  text: 'String',
  varchar: 'String',
  'character varying': 'String',
  char: 'String',
  character: 'String',
  name: 'String',
  citext: 'String',

  // Boolean
  boolean: 'Bool',
  bool: 'Bool',

  // Date/Time
  timestamp: 'Date',
  'timestamp without time zone': 'Date',
  timestamptz: 'Date',
  'timestamp with time zone': 'Date',
  date: 'Date',
  time: 'String',
  'time without time zone': 'String',
  timetz: 'String',
  'time with time zone': 'String',
  interval: 'String',

  // Binary
  bytea: 'Data',

  // JSON — use String since [String: Any] doesn't conform to Codable
  json: 'String',
  jsonb: 'String',

  // UUID
  uuid: 'UUID',

  // Network
  inet: 'String',
  cidr: 'String',
  macaddr: 'String',
  macaddr8: 'String',

  // MySQL types
  tinyint: 'Int',
  mediumint: 'Int',
  datetime: 'Date',
  tinytext: 'String',
  mediumtext: 'String',
  longtext: 'String',
  blob: 'Data',
  mediumblob: 'Data',
  longblob: 'Data',
  enum: 'String',
  set: 'String',
}

/**
 * Map a PostgreSQL type to a Swift type string.
 * Nullable types use Swift optionals with `?` suffix.
 */
export function pgToSwift(pgType: string, nullable: boolean, category?: string): string {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays: text[] or _text
  if (normalized.endsWith('[]')) {
    const base = pgToSwift(normalized.slice(0, -2), false)
    return nullable ? `[${base}]?` : `[${base}]`
  }
  if (normalized.startsWith('_')) {
    const base = pgToSwift(normalized.slice(1), false)
    return nullable ? `[${base}]?` : `[${base}]`
  }

  // Strip length specifiers
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  let swiftType = PG_TO_SWIFT[baseType]

  if (swiftType === undefined && category) {
    swiftType = CATEGORY_TO_SWIFT[category]
  }

  if (swiftType === undefined) {
    swiftType = 'Any'
  }

  return nullable ? `${swiftType}?` : swiftType
}
