/** Category-based mapping — used when schema inspection provides a type category */
const CATEGORY_TO_JAVA: Record<string, [string, string | null]> = {
  string: ['String', null],
  integer: ['long', null],
  float: ['double', null],
  decimal: ['BigDecimal', 'java.math.BigDecimal'],
  boolean: ['boolean', null],
  time: ['LocalDateTime', 'java.time.LocalDateTime'],
  binary: ['byte[]', null],
  json: ['String', null],
  uuid: ['UUID', 'java.util.UUID'],
  spatial: ['String', null],
  enum: ['String', null], // overridden per-column with actual enum type
  unknown: ['Object', null],
}

// Java uses wrapper types for nullable primitives
const PG_TO_JAVA: Record<string, [string, string | null]> = {
  // [javaType, importPath] -- primitive types have wrapper equivalents for nullable
  // Numeric
  smallint: ['short', null],
  int2: ['short', null],
  integer: ['int', null],
  int: ['int', null],
  int4: ['int', null],
  bigint: ['long', null],
  int8: ['long', null],
  serial: ['int', null],
  serial4: ['int', null],
  bigserial: ['long', null],
  serial8: ['long', null],
  smallserial: ['short', null],
  serial2: ['short', null],
  real: ['float', null],
  float4: ['float', null],
  'double precision': ['double', null],
  float8: ['double', null],
  numeric: ['BigDecimal', 'java.math.BigDecimal'],
  decimal: ['BigDecimal', 'java.math.BigDecimal'],
  money: ['BigDecimal', 'java.math.BigDecimal'],

  // String
  text: ['String', null],
  varchar: ['String', null],
  'character varying': ['String', null],
  char: ['String', null],
  character: ['String', null],
  name: ['String', null],
  citext: ['String', null],

  // Boolean
  boolean: ['boolean', null],
  bool: ['boolean', null],

  // Date/Time
  timestamp: ['LocalDateTime', 'java.time.LocalDateTime'],
  'timestamp without time zone': ['LocalDateTime', 'java.time.LocalDateTime'],
  timestamptz: ['OffsetDateTime', 'java.time.OffsetDateTime'],
  'timestamp with time zone': ['OffsetDateTime', 'java.time.OffsetDateTime'],
  date: ['LocalDate', 'java.time.LocalDate'],
  time: ['LocalTime', 'java.time.LocalTime'],
  'time without time zone': ['LocalTime', 'java.time.LocalTime'],
  timetz: ['LocalTime', 'java.time.LocalTime'],
  'time with time zone': ['LocalTime', 'java.time.LocalTime'],
  interval: ['Duration', 'java.time.Duration'],

  // Binary
  bytea: ['byte[]', null],

  // JSON
  json: ['String', null],
  jsonb: ['String', null],

  // UUID
  uuid: ['UUID', 'java.util.UUID'],

  // Network
  inet: ['String', null],
  cidr: ['String', null],
  macaddr: ['String', null],
}

// Mapping from primitive types to their wrapper types for nullable
const PRIMITIVE_TO_WRAPPER: Record<string, string> = {
  short: 'Short',
  int: 'Integer',
  long: 'Long',
  float: 'Float',
  double: 'Double',
  boolean: 'Boolean',
  'byte[]': 'byte[]',
}

/**
 * Map a PostgreSQL type to a Java type and required imports.
 * Nullable primitive types use their wrapper equivalents (int -> Integer, long -> Long).
 */
export function pgToJava(pgType: string, nullable: boolean, category?: string): { type: string; imports: string[] } {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays
  if (normalized.endsWith('[]')) {
    const base = pgToJava(normalized.slice(0, -2), false)
    const wrappedType = PRIMITIVE_TO_WRAPPER[base.type] ?? base.type
    const imports = [...base.imports]
    if (!imports.includes('java.util.List')) imports.push('java.util.List')
    return { type: `List<${wrappedType}>`, imports }
  }
  if (normalized.startsWith('_')) {
    const base = pgToJava(normalized.slice(1), false)
    const wrappedType = PRIMITIVE_TO_WRAPPER[base.type] ?? base.type
    const imports = [...base.imports]
    if (!imports.includes('java.util.List')) imports.push('java.util.List')
    return { type: `List<${wrappedType}>`, imports }
  }

  // Strip length specifiers
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  // Try raw type lookup first for precise mapping
  let mapping = PG_TO_JAVA[baseType]

  // Fall back to category-based mapping for unknown raw types
  if (!mapping && category) {
    mapping = CATEGORY_TO_JAVA[category]
  }

  if (!mapping) return { type: 'Object', imports: [] }

  const [javaType, importPath] = mapping
  const imports = importPath ? [importPath] : []

  if (nullable) {
    const wrapper = PRIMITIVE_TO_WRAPPER[javaType]
    if (wrapper) {
      return { type: wrapper, imports }
    }
  }

  return { type: javaType, imports }
}
