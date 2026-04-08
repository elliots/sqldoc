/** Category-based mapping — used when Atlas provides a type category */
const CATEGORY_TO_PHP: Record<string, string> = {
  string: 'string',
  integer: 'int',
  float: 'float',
  decimal: 'float',
  boolean: 'bool',
  time: 'string',
  binary: 'string',
  json: 'array',
  uuid: 'string',
  spatial: 'string',
  enum: 'string',
  unknown: 'mixed',
}

const PG_TO_PHP: Record<string, string> = {
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
  numeric: 'float',
  decimal: 'float',
  money: 'string',

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
  timestamp: 'string',
  'timestamp without time zone': 'string',
  timestamptz: 'string',
  'timestamp with time zone': 'string',
  date: 'string',
  time: 'string',
  'time without time zone': 'string',
  timetz: 'string',
  'time with time zone': 'string',
  interval: 'string',

  // Binary
  bytea: 'string',

  // JSON
  json: 'array',
  jsonb: 'array',

  // UUID
  uuid: 'string',

  // Network
  inet: 'string',
  cidr: 'string',
  macaddr: 'string',
  macaddr8: 'string',

  // MySQL types
  tinyint: 'int',
  mediumint: 'int',
  datetime: 'string',
  tinytext: 'string',
  mediumtext: 'string',
  longtext: 'string',
  blob: 'string',
  mediumblob: 'string',
  longblob: 'string',
  enum: 'string',
  set: 'string',
}

/**
 * Map a PostgreSQL type to a PHP type string.
 * Nullable types use the `?` prefix (PHP nullable type syntax).
 */
export function pgToPhp(pgType: string, nullable: boolean, category?: string): string {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays: text[] or _text
  if (normalized.endsWith('[]') || normalized.startsWith('_')) {
    return nullable ? '?array' : 'array'
  }

  // Strip length specifiers
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  let phpType = PG_TO_PHP[baseType]

  if (phpType === undefined && category) {
    phpType = CATEGORY_TO_PHP[category]
  }

  if (phpType === undefined) {
    phpType = 'mixed'
  }

  // PHP's `mixed` type already includes null — `?mixed` is a fatal error
  if (phpType === 'mixed') return 'mixed'

  return nullable ? `?${phpType}` : phpType
}

/** Map a PostgreSQL type to an Eloquent $casts value */
export function pgToEloquentCast(pgType: string, category?: string): string | undefined {
  const normalized = pgType.toLowerCase().trim()

  if (normalized.endsWith('[]') || normalized.startsWith('_')) return 'array'

  // Extract scale from numeric/decimal(p,s) for Eloquent's decimal:s cast
  const scaleMatch = normalized.match(/(?:numeric|decimal)\(\d+,\s*(\d+)\)/)
  const decimalScale = scaleMatch ? scaleMatch[1] : undefined

  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  const CAST_MAP: Record<string, string> = {
    boolean: 'boolean',
    bool: 'boolean',
    integer: 'integer',
    int: 'integer',
    int4: 'integer',
    smallint: 'integer',
    int2: 'integer',
    bigint: 'integer',
    int8: 'integer',
    real: 'float',
    float4: 'float',
    'double precision': 'float',
    float8: 'float',
    numeric: 'decimal',
    decimal: 'decimal',
    json: 'array',
    jsonb: 'array',
    timestamp: 'datetime',
    'timestamp without time zone': 'datetime',
    timestamptz: 'datetime',
    'timestamp with time zone': 'datetime',
    date: 'date',
  }

  let cast = CAST_MAP[baseType]
  if (cast === undefined && category) {
    const CATEGORY_CAST: Record<string, string> = {
      boolean: 'boolean',
      integer: 'integer',
      float: 'float',
      decimal: 'decimal',
      json: 'array',
      time: 'datetime',
    }
    cast = CATEGORY_CAST[category]
  }

  // Eloquent's decimal cast requires a scale suffix: decimal:2
  if (cast === 'decimal' && decimalScale) {
    return `decimal:${decimalScale}`
  }

  return cast
}
