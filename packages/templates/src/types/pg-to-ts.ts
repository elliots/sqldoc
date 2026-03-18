export interface TsTypeOptions {
  dateType?: 'Date' | 'temporal' | 'dayjs' | 'luxon' | 'string'
  nullableStyle?: 'optional' | 'null-union'
  bigintType?: 'number' | 'bigint' | 'string'
}

/** Category-based mapping — used when Atlas provides a type category */
const CATEGORY_TO_TS: Record<string, string> = {
  string: 'string',
  integer: 'number',
  float: 'number',
  decimal: 'string',
  boolean: 'boolean',
  time: 'Date',
  binary: 'Buffer',
  json: 'unknown',
  uuid: 'string',
  spatial: 'string',
  enum: 'string', // overridden per-column with actual enum type
  unknown: 'unknown',
}

const PG_TO_TS: Record<string, string> = {
  // Numeric
  smallint: 'number',
  int2: 'number',
  integer: 'number',
  int: 'number',
  int4: 'number',
  bigint: 'number',
  int8: 'number',
  serial: 'number',
  serial4: 'number',
  bigserial: 'number',
  serial8: 'number',
  smallserial: 'number',
  serial2: 'number',
  real: 'number',
  float4: 'number',
  'double precision': 'number',
  float8: 'number',
  numeric: 'string',
  decimal: 'string',
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
  boolean: 'boolean',
  bool: 'boolean',

  // Date/Time
  timestamp: 'Date',
  'timestamp without time zone': 'Date',
  timestamptz: 'Date',
  'timestamp with time zone': 'Date',
  date: 'string',
  time: 'string',
  'time without time zone': 'string',
  timetz: 'string',
  'time with time zone': 'string',
  interval: 'string',

  // Binary
  bytea: 'Buffer',

  // JSON
  json: 'unknown',
  jsonb: 'unknown',

  // UUID
  uuid: 'string',

  // Network
  inet: 'string',
  cidr: 'string',
  macaddr: 'string',
  macaddr8: 'string',

  // Geometric
  point: 'string',
  line: 'string',
  box: 'string',
  circle: 'string',
  polygon: 'string',
  path: 'string',

  // Other
  xml: 'string',
  tsvector: 'string',
  tsquery: 'string',
  oid: 'number',
}

/** Temporal API mappings — each SQL date/time type maps to the right Temporal type */
const TEMPORAL_MAP: Record<string, string> = {
  date: 'Temporal.PlainDate',
  timestamp: 'Temporal.PlainDateTime',
  'timestamp without time zone': 'Temporal.PlainDateTime',
  timestamptz: 'Temporal.ZonedDateTime',
  'timestamp with time zone': 'Temporal.ZonedDateTime',
  time: 'Temporal.PlainTime',
  'time without time zone': 'Temporal.PlainTime',
  timetz: 'string',
  'time with time zone': 'string',
  interval: 'Temporal.Duration',
}

/**
 * Map a PostgreSQL type to a TypeScript type string.
 * Handles arrays (text[], _text), length specifiers (varchar(255)), and nullability.
 */
export function pgToTs(pgType: string, nullable: boolean, options: TsTypeOptions = {}, category?: string): string {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays: text[] or _text
  if (normalized.endsWith('[]')) {
    const base = pgToTs(normalized.slice(0, -2), false, options)
    return wrapNullable(`${base}[]`, nullable, options.nullableStyle)
  }
  if (normalized.startsWith('_')) {
    const base = pgToTs(normalized.slice(1), false, options)
    return wrapNullable(`${base}[]`, nullable, options.nullableStyle)
  }

  // Strip length specifiers: varchar(255) -> varchar, numeric(10,2) -> numeric
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  // Try raw type lookup first for precise mapping
  let tsType = PG_TO_TS[baseType]

  // Fall back to category-based mapping for unknown raw types
  if (tsType === undefined && category) {
    tsType = CATEGORY_TO_TS[category]
  }

  if (tsType === undefined) {
    tsType = 'unknown'
  }

  // Apply bigintType option
  if (
    (baseType === 'bigint' || baseType === 'int8' || baseType === 'bigserial' || baseType === 'serial8') &&
    options.bigintType
  ) {
    tsType = options.bigintType
  }

  // Apply dateType option
  if (options.dateType === 'temporal') {
    const temporal = TEMPORAL_MAP[baseType]
    if (temporal) tsType = temporal
  } else if (options.dateType && options.dateType !== 'Date') {
    if (tsType === 'Date') {
      tsType = options.dateType === 'string' ? 'string' : `import('${options.dateType}').Dayjs`
    }
  }

  return wrapNullable(tsType, nullable, options.nullableStyle)
}

function wrapNullable(type: string, nullable: boolean, style?: 'optional' | 'null-union'): string {
  if (!nullable) return type
  if (style === 'null-union') return `${type} | null`
  return type // 'optional' style is handled at property level with ?:
}
