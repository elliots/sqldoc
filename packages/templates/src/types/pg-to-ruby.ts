/** Category-based mapping — used when Atlas provides a type category */
const CATEGORY_TO_RUBY: Record<string, string> = {
  string: 'String',
  integer: 'Integer',
  float: 'Float',
  decimal: 'BigDecimal',
  boolean: 'Boolean',
  time: 'DateTime',
  binary: 'String',
  json: 'Hash',
  uuid: 'String',
  spatial: 'String',
  enum: 'String',
  unknown: 'Object',
}

const PG_TO_RUBY: Record<string, string> = {
  // Numeric
  smallint: 'Integer',
  int2: 'Integer',
  integer: 'Integer',
  int: 'Integer',
  int4: 'Integer',
  bigint: 'Integer',
  int8: 'Integer',
  serial: 'Integer',
  serial4: 'Integer',
  bigserial: 'Integer',
  serial8: 'Integer',
  smallserial: 'Integer',
  serial2: 'Integer',
  real: 'Float',
  float4: 'Float',
  'double precision': 'Float',
  float8: 'Float',
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
  timestamp: 'DateTime',
  'timestamp without time zone': 'DateTime',
  timestamptz: 'DateTime',
  'timestamp with time zone': 'DateTime',
  date: 'Date',
  time: 'String',
  'time without time zone': 'String',
  timetz: 'String',
  'time with time zone': 'String',
  interval: 'String',

  // Binary
  bytea: 'String',

  // JSON
  json: 'Hash',
  jsonb: 'Hash',

  // UUID
  uuid: 'String',

  // Network
  inet: 'String',
  cidr: 'String',
  macaddr: 'String',
  macaddr8: 'String',

  // MySQL types
  tinyint: 'Integer',
  mediumint: 'Integer',
  datetime: 'DateTime',
  tinytext: 'String',
  mediumtext: 'String',
  longtext: 'String',
  blob: 'String',
  mediumblob: 'String',
  longblob: 'String',
  enum: 'String',
  set: 'String',
}

/**
 * Map a PostgreSQL type to a Ruby type string.
 * ActiveRecord handles nil natively — nullable doesn't change the type.
 */
export function pgToRuby(pgType: string, nullable: boolean, category?: string): string {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays: text[] or _text
  if (normalized.endsWith('[]')) {
    return 'Array'
  }
  if (normalized.startsWith('_')) {
    return 'Array'
  }

  // Strip length specifiers: varchar(255) -> varchar
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  let rubyType = PG_TO_RUBY[baseType]

  if (rubyType === undefined && category) {
    rubyType = CATEGORY_TO_RUBY[category]
  }

  return rubyType ?? 'Object'
}

/** Map a PostgreSQL type to an ActiveRecord attribute type symbol */
export function pgToActiveRecordType(pgType: string, category?: string): string {
  const normalized = pgType.toLowerCase().trim()

  if (normalized.endsWith('[]') || normalized.startsWith('_')) return 'array'

  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  const AR_TYPES: Record<string, string> = {
    smallint: 'integer',
    int2: 'integer',
    integer: 'integer',
    int: 'integer',
    int4: 'integer',
    bigint: 'integer',
    int8: 'integer',
    serial: 'integer',
    bigserial: 'integer',
    real: 'float',
    float4: 'float',
    'double precision': 'float',
    float8: 'float',
    numeric: 'decimal',
    decimal: 'decimal',
    money: 'decimal',
    text: 'string',
    varchar: 'string',
    'character varying': 'string',
    char: 'string',
    character: 'string',
    citext: 'string',
    boolean: 'boolean',
    bool: 'boolean',
    timestamp: 'datetime',
    'timestamp without time zone': 'datetime',
    timestamptz: 'datetime',
    'timestamp with time zone': 'datetime',
    date: 'date',
    time: 'time',
    'time without time zone': 'time',
    bytea: 'binary',
    json: 'json',
    jsonb: 'json',
    uuid: 'string',
    inet: 'string',
  }

  let arType = AR_TYPES[baseType]

  if (arType === undefined && category) {
    const CATEGORY_AR: Record<string, string> = {
      string: 'string',
      integer: 'integer',
      float: 'float',
      decimal: 'decimal',
      boolean: 'boolean',
      time: 'datetime',
      binary: 'binary',
      json: 'json',
      uuid: 'string',
    }
    arType = CATEGORY_AR[category]
  }

  return arType ?? 'string'
}
