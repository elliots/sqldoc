/** Category-based mapping — used when Atlas provides a type category */
const CATEGORY_TO_GO: Record<string, [string, string | null]> = {
  string: ['string', null],
  integer: ['int64', null],
  float: ['float64', null],
  decimal: ['string', null],
  boolean: ['bool', null],
  time: ['time.Time', 'time'],
  binary: ['[]byte', null],
  json: ['json.RawMessage', 'encoding/json'],
  uuid: ['uuid.UUID', 'github.com/google/uuid'],
  spatial: ['string', null],
  enum: ['string', null], // overridden per-column with actual enum type
  unknown: ['interface{}', null],
}

const PG_TO_GO: Record<string, [string, string | null]> = {
  // [goType, importPath]
  // Numeric
  smallint: ['int16', null],
  int2: ['int16', null],
  integer: ['int32', null],
  int: ['int32', null],
  int4: ['int32', null],
  bigint: ['int64', null],
  int8: ['int64', null],
  serial: ['int32', null],
  serial4: ['int32', null],
  bigserial: ['int64', null],
  serial8: ['int64', null],
  smallserial: ['int16', null],
  serial2: ['int16', null],
  real: ['float32', null],
  float4: ['float32', null],
  'double precision': ['float64', null],
  float8: ['float64', null],
  numeric: ['string', null],
  decimal: ['string', null],
  money: ['string', null],

  // String
  text: ['string', null],
  varchar: ['string', null],
  'character varying': ['string', null],
  char: ['string', null],
  character: ['string', null],
  name: ['string', null],
  citext: ['string', null],

  // Boolean
  boolean: ['bool', null],
  bool: ['bool', null],

  // Date/Time
  timestamp: ['time.Time', 'time'],
  'timestamp without time zone': ['time.Time', 'time'],
  timestamptz: ['time.Time', 'time'],
  'timestamp with time zone': ['time.Time', 'time'],
  date: ['time.Time', 'time'],
  time: ['string', null],
  'time without time zone': ['string', null],
  timetz: ['string', null],
  'time with time zone': ['string', null],
  interval: ['string', null],

  // Binary
  bytea: ['[]byte', null],

  // JSON
  json: ['json.RawMessage', 'encoding/json'],
  jsonb: ['json.RawMessage', 'encoding/json'],

  // UUID
  uuid: ['uuid.UUID', 'github.com/google/uuid'],

  // Network
  inet: ['string', null],
  cidr: ['string', null],
  macaddr: ['string', null],
  macaddr8: ['string', null],
}

/**
 * Map a PostgreSQL type to a Go type and required imports.
 * Nullable Go types use pointers: *string, *int64, etc.
 */
export function pgToGo(pgType: string, nullable: boolean, category?: string): { type: string; imports: string[] } {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays: text[] or _text
  if (normalized.endsWith('[]')) {
    const base = pgToGo(normalized.slice(0, -2), false)
    return { type: `[]${base.type}`, imports: base.imports }
  }
  if (normalized.startsWith('_')) {
    const base = pgToGo(normalized.slice(1), false)
    return { type: `[]${base.type}`, imports: base.imports }
  }

  // Strip length specifiers
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  // Try raw type lookup first for precise mapping
  let mapping = PG_TO_GO[baseType]

  // Fall back to category-based mapping for unknown raw types
  if (!mapping && category) {
    mapping = CATEGORY_TO_GO[category]
  }

  if (!mapping) return { type: 'interface{}', imports: [] }

  const [goType, importPath] = mapping
  const imports = importPath ? [importPath] : []

  if (nullable) {
    return { type: `*${goType}`, imports }
  }
  return { type: goType, imports }
}
