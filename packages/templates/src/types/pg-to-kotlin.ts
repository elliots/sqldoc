/** Category-based mapping — used when Atlas provides a type category */
const CATEGORY_TO_KOTLIN: Record<string, string> = {
  string: 'String',
  integer: 'Long',
  float: 'Double',
  decimal: 'BigDecimal',
  boolean: 'Boolean',
  time: 'LocalDateTime',
  binary: 'ByteArray',
  json: 'String',
  uuid: 'UUID',
  spatial: 'String',
  enum: 'String', // overridden per-column with actual enum type
  unknown: 'String',
}

const PG_TO_KOTLIN: Record<string, string> = {
  // Numeric
  smallint: 'Short',
  int2: 'Short',
  integer: 'Int',
  int: 'Int',
  int4: 'Int',
  bigint: 'Long',
  int8: 'Long',
  serial: 'Int',
  serial4: 'Int',
  bigserial: 'Long',
  serial8: 'Long',
  smallserial: 'Short',
  serial2: 'Short',
  real: 'Float',
  float4: 'Float',
  'double precision': 'Double',
  float8: 'Double',
  numeric: 'BigDecimal',
  decimal: 'BigDecimal',
  money: 'BigDecimal',

  // String
  text: 'String',
  varchar: 'String',
  'character varying': 'String',
  char: 'String',
  character: 'String',
  name: 'String',
  citext: 'String',

  // Boolean
  boolean: 'Boolean',
  bool: 'Boolean',

  // Date/Time
  timestamp: 'LocalDateTime',
  'timestamp without time zone': 'LocalDateTime',
  timestamptz: 'OffsetDateTime',
  'timestamp with time zone': 'OffsetDateTime',
  date: 'LocalDate',
  time: 'LocalTime',
  'time without time zone': 'LocalTime',
  timetz: 'LocalTime',
  'time with time zone': 'LocalTime',
  interval: 'Duration',

  // Binary
  bytea: 'ByteArray',

  // JSON
  json: 'String',
  jsonb: 'String',

  // UUID
  uuid: 'UUID',

  // Network
  inet: 'String',
  cidr: 'String',
  macaddr: 'String',
}

/**
 * Map a PostgreSQL type to a Kotlin type string.
 * Nullable types use Kotlin's ? suffix: String -> String?
 */
export function pgToKotlin(pgType: string, nullable: boolean, category?: string): string {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays
  if (normalized.endsWith('[]')) {
    const base = pgToKotlin(normalized.slice(0, -2), false)
    return wrapNullable(`List<${base}>`, nullable)
  }
  if (normalized.startsWith('_')) {
    const base = pgToKotlin(normalized.slice(1), false)
    return wrapNullable(`List<${base}>`, nullable)
  }

  // Strip length specifiers
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  // Try raw type lookup first for precise mapping
  let ktType = PG_TO_KOTLIN[baseType]

  // Fall back to category-based mapping for unknown raw types
  if (ktType === undefined && category) {
    ktType = CATEGORY_TO_KOTLIN[category]
  }

  if (ktType === undefined) {
    ktType = 'String'
  }

  return wrapNullable(ktType, nullable)
}

function wrapNullable(type: string, nullable: boolean): string {
  if (!nullable) return type
  return `${type}?`
}
