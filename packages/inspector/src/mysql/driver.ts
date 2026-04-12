// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/mysql/driver_oss.go, sql/mysql/inspect_oss.go

import type { Stmt } from '../migrate/lex.ts'
import { Scanner } from '../migrate/lex.ts'
import type { SchemaType } from '../schema/schema.ts'

// -- MySQL Type Constants --

export const TypeBool = 'bool'
export const TypeBoolean = 'boolean'
export const TypeBit = 'bit'
export const TypeInt = 'int'
export const TypeTinyInt = 'tinyint'
export const TypeSmallInt = 'smallint'
export const TypeMediumInt = 'mediumint'
export const TypeBigInt = 'bigint'
export const TypeDecimal = 'decimal'
export const TypeNumeric = 'numeric'
export const TypeFloat = 'float'
export const TypeDouble = 'double'
export const TypeReal = 'real'
export const TypeTimestamp = 'timestamp'
export const TypeDate = 'date'
export const TypeTime = 'time'
export const TypeDateTime = 'datetime'
export const TypeYear = 'year'
export const TypeVarchar = 'varchar'
export const TypeChar = 'char'
export const TypeVarBinary = 'varbinary'
export const TypeBinary = 'binary'
export const TypeBlob = 'blob'
export const TypeTinyBlob = 'tinyblob'
export const TypeMediumBlob = 'mediumblob'
export const TypeLongBlob = 'longblob'
export const TypeText = 'text'
export const TypeTinyText = 'tinytext'
export const TypeMediumText = 'mediumtext'
export const TypeLongText = 'longtext'
export const TypeEnum = 'enum'
export const TypeSet = 'set'
export const TypeJSON = 'json'
export const TypeGeometry = 'geometry'
export const TypePoint = 'point'
export const TypeMultiPoint = 'multipoint'
export const TypeLineString = 'linestring'
export const TypeMultiLineString = 'multilinestring'
export const TypePolygon = 'polygon'
export const TypeMultiPolygon = 'multipolygon'
export const TypeGeoCollection = 'geomcollection'
export const TypeGeometryCollection = 'geometrycollection'
export const TypeUUID = 'uuid'
export const TypeInet4 = 'inet4'
export const TypeInet6 = 'inet6'

// -- Index Type Constants --

export const IndexTypeBTree = 'BTREE'
export const IndexTypeHash = 'HASH'
export const IndexTypeFullText = 'FULLTEXT'
export const IndexTypeSpatial = 'SPATIAL'

// -- Engine Constants --

export const EngineInnoDB = 'InnoDB'
export const EngineMyISAM = 'MyISAM'
export const EngineMemory = 'Memory'
export const EngineCSV = 'CSV'
export const EngineNDB = 'NDB'

// -- Internal Constants --

export const currentTS = 'current_timestamp'
export const defaultGen = 'default_generated'
export const autoIncrement = 'auto_increment'
export const virtual = 'VIRTUAL'
export const stored = 'STORED'
export const persistent = 'PERSISTENT'

// -- MySQL System Schema Filter --

export const systemSchemas = ['information_schema', 'innodb', 'mysql', 'performance_schema', 'sys']

// -- SQL Queries for MySQL information_schema inspection --

export const variablesQuery = 'SELECT @@version, @@collation_server, @@character_set_server, @@lower_case_table_names'

export const schemasQuery =
  "SELECT `SCHEMA_NAME`, `DEFAULT_CHARACTER_SET_NAME`, `DEFAULT_COLLATION_NAME` from `INFORMATION_SCHEMA`.`SCHEMATA` WHERE `SCHEMA_NAME` NOT IN ('information_schema','innodb','mysql','performance_schema','sys') ORDER BY `SCHEMA_NAME`"

export const schemasQueryArgs =
  'SELECT `SCHEMA_NAME`, `DEFAULT_CHARACTER_SET_NAME`, `DEFAULT_COLLATION_NAME` from `INFORMATION_SCHEMA`.`SCHEMATA` WHERE `SCHEMA_NAME` %s ORDER BY `SCHEMA_NAME`'

export const columnsQuery =
  'SELECT `TABLE_NAME`, `COLUMN_NAME`, `COLUMN_TYPE`, `COLUMN_COMMENT`, `IS_NULLABLE`, `COLUMN_KEY`, `COLUMN_DEFAULT`, `EXTRA`, `CHARACTER_SET_NAME`, `COLLATION_NAME`, NULL AS `GENERATION_EXPRESSION` FROM `INFORMATION_SCHEMA`.`COLUMNS` WHERE `TABLE_SCHEMA` = ? AND `TABLE_NAME` IN (%s) ORDER BY `ORDINAL_POSITION`'

export const columnsExprQuery =
  'SELECT `TABLE_NAME`, `COLUMN_NAME`, `COLUMN_TYPE`, `COLUMN_COMMENT`, `IS_NULLABLE`, `COLUMN_KEY`, `COLUMN_DEFAULT`, `EXTRA`, `CHARACTER_SET_NAME`, `COLLATION_NAME`, `GENERATION_EXPRESSION` FROM `INFORMATION_SCHEMA`.`COLUMNS` WHERE `TABLE_SCHEMA` = ? AND `TABLE_NAME` IN (%s) ORDER BY `ORDINAL_POSITION`'

export const indexesQuery =
  "SELECT `TABLE_NAME`, `INDEX_NAME`, `COLUMN_NAME`, `NON_UNIQUE`, `SEQ_IN_INDEX`, `INDEX_TYPE`, UPPER(`COLLATION`) = 'D' AS `DESC`, `INDEX_COMMENT`, `SUB_PART`, NULL AS `EXPRESSION` FROM `INFORMATION_SCHEMA`.`STATISTICS` WHERE `TABLE_SCHEMA` = ? AND `TABLE_NAME` IN (%s) ORDER BY `index_name`, `seq_in_index`"

export const indexesExprQuery =
  "SELECT `TABLE_NAME`, `INDEX_NAME`, `COLUMN_NAME`, `NON_UNIQUE`, `SEQ_IN_INDEX`, `INDEX_TYPE`, UPPER(`COLLATION`) = 'D' AS `DESC`, `INDEX_COMMENT`, `SUB_PART`, `EXPRESSION` FROM `INFORMATION_SCHEMA`.`STATISTICS` WHERE `TABLE_SCHEMA` = ? AND `TABLE_NAME` IN (%s) ORDER BY `index_name`, `seq_in_index`"

export const indexesNoCommentQuery =
  "SELECT `TABLE_NAME`, `INDEX_NAME`, `COLUMN_NAME`, `NON_UNIQUE`, `SEQ_IN_INDEX`, `INDEX_TYPE`, UPPER(`COLLATION`) = 'D' AS `DESC`, NULL AS `INDEX_COMMENT`, `SUB_PART`, NULL AS `EXPRESSION` FROM `INFORMATION_SCHEMA`.`STATISTICS` WHERE `TABLE_SCHEMA` = ? AND `TABLE_NAME` IN (%s) ORDER BY `index_name`, `seq_in_index`"

export const tablesQuery = `
SELECT
  t1.TABLE_SCHEMA,
  t1.TABLE_NAME,
  t2.CHARACTER_SET_NAME,
  t1.TABLE_COLLATION,
  t1.AUTO_INCREMENT,
  t1.TABLE_COMMENT,
  t1.CREATE_OPTIONS,
  t1.ENGINE,
  t3.SUPPORT = 'DEFAULT' AS DEFAULT_ENGINE,
  t1.TABLE_TYPE
FROM
  INFORMATION_SCHEMA.TABLES AS t1
  LEFT JOIN INFORMATION_SCHEMA.COLLATIONS AS t2
  ON t1.TABLE_COLLATION = t2.COLLATION_NAME
  LEFT JOIN INFORMATION_SCHEMA.ENGINES AS t3
  ON t1.ENGINE = t3.ENGINE
WHERE
  TABLE_SCHEMA IN (%s)
  AND TABLE_TYPE = 'BASE TABLE'
ORDER BY
  TABLE_SCHEMA, TABLE_NAME`

export const tablesQueryArgs = `
SELECT
  t1.TABLE_SCHEMA,
  t1.TABLE_NAME,
  t2.CHARACTER_SET_NAME,
  t1.TABLE_COLLATION,
  t1.AUTO_INCREMENT,
  t1.TABLE_COMMENT,
  t1.CREATE_OPTIONS,
  t1.ENGINE,
  t3.SUPPORT = 'DEFAULT' AS DEFAULT_ENGINE,
  t1.TABLE_TYPE
FROM
  INFORMATION_SCHEMA.TABLES AS t1
  JOIN INFORMATION_SCHEMA.COLLATIONS AS t2
  ON t1.TABLE_COLLATION = t2.COLLATION_NAME
  LEFT JOIN INFORMATION_SCHEMA.ENGINES AS t3
  ON t1.ENGINE = t3.ENGINE
WHERE
  TABLE_SCHEMA IN (%s)
  AND TABLE_NAME IN (%s)
  AND TABLE_TYPE = 'BASE TABLE'
ORDER BY
  TABLE_SCHEMA, TABLE_NAME`

export const myChecksQuery = `
SELECT
  t1.TABLE_NAME,
  t1.CONSTRAINT_NAME,
  t2.CHECK_CLAUSE,
  t1.ENFORCED
FROM
  INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS t1
  JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS AS t2
  ON t1.CONSTRAINT_NAME = t2.CONSTRAINT_NAME
  AND t1.CONSTRAINT_SCHEMA = t2.CONSTRAINT_SCHEMA
WHERE
  t1.CONSTRAINT_TYPE = 'CHECK'
  AND t1.TABLE_SCHEMA = ?
  AND t1.TABLE_NAME IN (%s)
ORDER BY
  t1.TABLE_NAME, t1.CONSTRAINT_NAME
`

export const marChecksQuery = `
SELECT
  TABLE_NAME,
  CONSTRAINT_NAME,
  CHECK_CLAUSE,
  "YES" AS ENFORCED
FROM
  INFORMATION_SCHEMA.CHECK_CONSTRAINTS
WHERE
  CONSTRAINT_SCHEMA = ?
  AND TABLE_NAME IN (%s)
ORDER BY
  TABLE_NAME, CONSTRAINT_NAME
`

export const fksQuery = `
SELECT
  t1.CONSTRAINT_NAME,
  t1.TABLE_NAME,
  t1.COLUMN_NAME,
  t1.TABLE_SCHEMA,
  t1.REFERENCED_TABLE_NAME,
  t1.REFERENCED_COLUMN_NAME,
  t1.REFERENCED_TABLE_SCHEMA,
  t2.UPDATE_RULE,
  t2.DELETE_RULE
FROM
  INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS t1
  JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS AS t2
  ON t1.CONSTRAINT_NAME = t2.CONSTRAINT_NAME
WHERE
  t1.REFERENCED_COLUMN_NAME IS NOT NULL
  AND BINARY t1.TABLE_SCHEMA = ?
  AND BINARY t2.CONSTRAINT_SCHEMA = ?
  AND t1.TABLE_NAME IN (%s)
ORDER BY
  BINARY t1.TABLE_NAME,
  BINARY t1.CONSTRAINT_NAME,
  t1.ORDINAL_POSITION`

export const viewsQuery = `
SELECT
  TABLE_SCHEMA,
  TABLE_NAME,
  VIEW_DEFINITION,
  CHECK_OPTION
FROM
  INFORMATION_SCHEMA.VIEWS
WHERE
  TABLE_SCHEMA IN (%s)
ORDER BY
  TABLE_SCHEMA, TABLE_NAME`

export const triggersQuery = `
SELECT
  TRIGGER_SCHEMA,
  TRIGGER_NAME,
  EVENT_OBJECT_TABLE,
  ACTION_TIMING,
  EVENT_MANIPULATION,
  ACTION_STATEMENT
FROM
  INFORMATION_SCHEMA.TRIGGERS
WHERE
  TRIGGER_SCHEMA IN (%s)
ORDER BY
  TRIGGER_SCHEMA, EVENT_OBJECT_TABLE, TRIGGER_NAME`

export const routinesQuery = `
SELECT
  ROUTINE_SCHEMA,
  ROUTINE_NAME,
  ROUTINE_TYPE,
  ROUTINE_DEFINITION,
  EXTERNAL_LANGUAGE,
  DTD_IDENTIFIER
FROM
  INFORMATION_SCHEMA.ROUTINES
WHERE
  ROUTINE_SCHEMA IN (%s)
ORDER BY
  ROUTINE_SCHEMA, ROUTINE_TYPE, ROUTINE_NAME`

export const parametersQuery = `
SELECT
  SPECIFIC_SCHEMA,
  SPECIFIC_NAME,
  ORDINAL_POSITION,
  PARAMETER_MODE,
  PARAMETER_NAME,
  DTD_IDENTIFIER
FROM
  INFORMATION_SCHEMA.PARAMETERS
WHERE
  SPECIFIC_SCHEMA IN (%s)
  AND ORDINAL_POSITION > 0
ORDER BY
  SPECIFIC_SCHEMA, SPECIFIC_NAME, ORDINAL_POSITION`

export const partitionsQuery = `
SELECT
  TABLE_NAME,
  PARTITION_METHOD,
  PARTITION_EXPRESSION
FROM
  INFORMATION_SCHEMA.PARTITIONS
WHERE
  TABLE_SCHEMA = ?
  AND TABLE_NAME IN (%s)
  AND PARTITION_NAME IS NOT NULL
GROUP BY
  TABLE_NAME, PARTITION_METHOD, PARTITION_EXPRESSION
ORDER BY
  TABLE_NAME`

// -- MySQL Type Parsing --

/**
 * Parse a MySQL column type string into parts, size, and unsigned status.
 * Handles MariaDB-style embedded comments like "int(11) / * mariadb-5.3 * /".
 */
export function parseColumn(typ: string): { parts: string[]; size: number; unsigned: boolean } {
  // Remove MariaDB embedded comments
  const commentIdx = typ.indexOf('/*')
  if (commentIdx > 0 && typ.trimEnd().endsWith('*/')) {
    typ = typ.slice(0, commentIdx).trim()
  }

  const parts = typ.split(/[() ,]+/).filter((p) => p !== '')
  if (parts.length === 0) {
    throw new Error(`unexpected or empty type "${typ}"`)
  }

  let unsigned = false
  let size = 0
  const t = parts[0].toLowerCase()

  switch (t) {
    case TypeBit:
    case TypeBinary:
    case TypeVarBinary:
    case TypeChar:
    case TypeVarchar:
      break
    case TypeTinyInt:
    case TypeSmallInt:
    case TypeMediumInt:
    case TypeInt:
    case TypeBigInt:
    case TypeDecimal:
    case TypeNumeric:
    case TypeFloat:
    case TypeDouble:
    case TypeReal: {
      const last = parts[parts.length - 1].toLowerCase()
      if (last === 'unsigned' || last === 'zerofill') {
        unsigned = true
      }
      break
    }
  }

  if (parts.length > 1 && /^\d+$/.test(parts[1])) {
    size = parseInt(parts[1], 10)
  }

  return { parts, size, unsigned }
}

/**
 * Parse a MySQL COLUMN_TYPE string into a SchemaType.
 * Follows the MySQL information_schema format.
 */
export function parseType(raw: string): SchemaType {
  const { parts, size, unsigned } = parseColumn(raw)
  const t = parts[0].toLowerCase()

  switch (t) {
    case TypeBit:
      return { kind: 'binary', T: t, size }

    case TypeBool:
    case TypeBoolean:
      return { kind: 'boolean', T: TypeBool }

    case TypeTinyInt:
    case TypeSmallInt:
    case TypeMediumInt:
    case TypeInt:
    case TypeBigInt:
      if (size === 1) {
        return { kind: 'boolean', T: TypeBool }
      }
      return { kind: 'integer', T: t, unsigned }

    case TypeNumeric:
    case TypeDecimal: {
      const dt: SchemaType = { kind: 'decimal', T: t }
      if (parts.length > 1 && parts[1] !== 'unsigned') {
        ;(dt as any).precision = parseInt(parts[1], 10)
      }
      if (parts.length > 2 && parts[2] !== 'unsigned') {
        ;(dt as any).scale = parseInt(parts[2], 10)
      }
      return dt
    }

    case TypeFloat:
    case TypeDouble:
    case TypeReal: {
      const ft: SchemaType = { kind: 'float', T: t }
      if (parts.length > 1 && parts[1] !== 'unsigned') {
        ;(ft as any).precision = parseInt(parts[1], 10)
      }
      return ft
    }

    case TypeBinary:
    case TypeVarBinary:
      return { kind: 'binary', T: t, size: parts.length > 1 ? size : undefined }

    case TypeTinyBlob:
    case TypeMediumBlob:
    case TypeBlob:
    case TypeLongBlob:
      return { kind: 'binary', T: t }

    case TypeChar:
    case TypeVarchar:
      return { kind: 'string', T: t, size }

    case TypeTinyText:
    case TypeMediumText:
    case TypeText:
    case TypeLongText:
      return { kind: 'string', T: t }

    case TypeEnum:
    case TypeSet: {
      // Parse enum/set values from the raw column type: enum('a','b','c')
      const rv = raw.slice(t.length + 1, -1) // strip "enum(" and ")"
      if (!rv) {
        throw new Error(`unexpected enum type: "${raw}"`)
      }
      // Parse SQL quoted literals properly (handles escaped quotes like 'Bob''s')
      const values: string[] = []
      const re = /'((?:[^']|'')*)'/g
      let m: RegExpExecArray | null
      while ((m = re.exec(rv)) !== null) {
        values.push(m[1].replaceAll("''", "'"))
      }
      if (t === TypeEnum) {
        return { kind: 'enum', T: TypeEnum, values }
      }
      // SET type represented as enum in our type system
      return { kind: 'enum', T: TypeSet, values }
    }

    case TypeDate:
    case TypeDateTime:
    case TypeTime:
    case TypeTimestamp:
    case TypeYear: {
      const tt: SchemaType = { kind: 'time', T: t }
      if (parts.length > 1) {
        ;(tt as any).precision = parseInt(parts[1], 10)
      }
      return tt
    }

    case TypeJSON:
      return { kind: 'json', T: t }

    case TypePoint:
    case TypeMultiPoint:
    case TypeLineString:
    case TypeMultiLineString:
    case TypePolygon:
    case TypeMultiPolygon:
    case TypeGeometry:
    case TypeGeoCollection:
    case TypeGeometryCollection:
      return { kind: 'spatial', T: t }

    case TypeUUID:
      return { kind: 'uuid', T: t }

    case TypeInet4:
    case TypeInet6:
      return { kind: 'unsupported', T: t }

    default:
      return { kind: 'unsupported', T: t }
  }
}

// -- Helper: unescape backslash-escaped strings from information_schema --

export function unescapeStr(s: string): string {
  let result = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\' || i === s.length - 1) {
      result += c
    } else if (s[i + 1] === "'" || s[i + 1] === '\\') {
      result += s[i + 1]
      i++
    } else {
      result += c
    }
  }
  return result
}

// -- Helper: generate N placeholders --

export function nArgs(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ')
}

// -- Helper: check if hex --

export function isHex(x: string): boolean {
  return x.length > 2 && x.slice(0, 2).toLowerCase() === '0x'
}

// -- Helper: quote string for SQL --

export function quote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s
  }
  return JSON.stringify(s)
}

/** Returns 'STORED' or 'VIRTUAL' from a generation type string. */
export function storedOrVirtual(typ: string | undefined): string {
  if (!typ) return virtual
  const upper = typ.toUpperCase()
  if (upper === stored || upper === persistent) return stored
  return virtual
}

/** MySQL-specific statement scanner. Matches Go Driver.ScanStmts. */
export function mysqlScanStmts(input: string): Stmt[] {
  return new Scanner({
    matchBegin: true,
    backslashEscapes: true,
    hashComments: true,
    // MySQL/MariaDB do NOT support these:
    matchBeginAtomic: false,
    matchDollarQuote: false,
  }).scan(input)
}
