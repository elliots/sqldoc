/** Category-based mapping — used when schema inspection provides a type category */
const CATEGORY_TO_RUST: Record<string, [string, string | null]> = {
  string: ['String', null],
  integer: ['i64', null],
  float: ['f64', null],
  decimal: ['bigdecimal::BigDecimal', 'bigdecimal::BigDecimal'],
  boolean: ['bool', null],
  time: ['NaiveDateTime', 'chrono::NaiveDateTime'],
  binary: ['Vec<u8>', null],
  json: ['serde_json::Value', 'serde_json::Value'],
  uuid: ['Uuid', 'uuid::Uuid'],
  spatial: ['String', null],
  enum: ['String', null], // overridden per-column with actual enum type
  unknown: ['String', null],
}

const PG_TO_RUST: Record<string, [string, string | null]> = {
  // [rustType, importPath]
  // Numeric
  smallint: ['i16', null],
  int2: ['i16', null],
  integer: ['i32', null],
  int: ['i32', null],
  int4: ['i32', null],
  bigint: ['i64', null],
  int8: ['i64', null],
  serial: ['i32', null],
  serial4: ['i32', null],
  bigserial: ['i64', null],
  serial8: ['i64', null],
  smallserial: ['i16', null],
  serial2: ['i16', null],
  real: ['f32', null],
  float4: ['f32', null],
  'double precision': ['f64', null],
  float8: ['f64', null],
  numeric: ['bigdecimal::BigDecimal', 'bigdecimal::BigDecimal'],
  decimal: ['bigdecimal::BigDecimal', 'bigdecimal::BigDecimal'],
  money: ['String', null],

  // String
  text: ['String', null],
  varchar: ['String', null],
  'character varying': ['String', null],
  char: ['String', null],
  character: ['String', null],
  name: ['String', null],
  citext: ['String', null],

  // Boolean
  boolean: ['bool', null],
  bool: ['bool', null],

  // Date/Time
  timestamp: ['NaiveDateTime', 'chrono::NaiveDateTime'],
  'timestamp without time zone': ['NaiveDateTime', 'chrono::NaiveDateTime'],
  timestamptz: ['DateTime<Utc>', 'chrono::{DateTime, Utc}'],
  'timestamp with time zone': ['DateTime<Utc>', 'chrono::{DateTime, Utc}'],
  date: ['NaiveDate', 'chrono::NaiveDate'],
  time: ['NaiveTime', 'chrono::NaiveTime'],
  'time without time zone': ['NaiveTime', 'chrono::NaiveTime'],
  timetz: ['NaiveTime', 'chrono::NaiveTime'],
  'time with time zone': ['NaiveTime', 'chrono::NaiveTime'],
  interval: ['PgInterval', null],

  // Binary
  bytea: ['Vec<u8>', null],

  // JSON
  json: ['serde_json::Value', 'serde_json::Value'],
  jsonb: ['serde_json::Value', 'serde_json::Value'],

  // UUID
  uuid: ['Uuid', 'uuid::Uuid'],

  // Network
  inet: ['String', null],
  cidr: ['String', null],
  macaddr: ['String', null],
}

/**
 * Map a PostgreSQL type to a Rust type and required imports.
 * Nullable types use Option<T>.
 */
export function pgToRust(pgType: string, nullable: boolean, category?: string): { type: string; imports: string[] } {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays
  if (normalized.endsWith('[]')) {
    const base = pgToRust(normalized.slice(0, -2), false)
    const vecType = `Vec<${base.type}>`
    return nullable ? { type: `Option<${vecType}>`, imports: base.imports } : { type: vecType, imports: base.imports }
  }
  if (normalized.startsWith('_')) {
    const base = pgToRust(normalized.slice(1), false)
    const vecType = `Vec<${base.type}>`
    return nullable ? { type: `Option<${vecType}>`, imports: base.imports } : { type: vecType, imports: base.imports }
  }

  // Strip length specifiers
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  // Try raw type lookup first for precise mapping
  let mapping = PG_TO_RUST[baseType]

  // Fall back to category-based mapping for unknown raw types
  if (!mapping && category) {
    mapping = CATEGORY_TO_RUST[category]
  }

  if (!mapping) return { type: 'String', imports: [] }

  const [rustType, importPath] = mapping
  const imports = importPath ? [importPath] : []

  if (nullable) {
    return { type: `Option<${rustType}>`, imports }
  }
  return { type: rustType, imports }
}
