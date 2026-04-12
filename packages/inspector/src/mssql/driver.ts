import type { Stmt } from '../migrate/lex.ts'
import { Scanner } from '../migrate/lex.ts'
import type { ReferenceAction, SchemaType } from '../schema/schema.ts'

// -- MSSQL Type Constants: Integer --

export const TypeBigInt = 'bigint'
export const TypeInt = 'int'
export const TypeSmallInt = 'smallint'
export const TypeTinyInt = 'tinyint'

// -- MSSQL Type Constants: Boolean --

export const TypeBit = 'bit'

// -- MSSQL Type Constants: Decimal --

export const TypeDecimal = 'decimal'
export const TypeNumeric = 'numeric'
export const TypeMoney = 'money'
export const TypeSmallMoney = 'smallmoney'

// -- MSSQL Type Constants: Float --

export const TypeFloat = 'float'
export const TypeReal = 'real'

// -- MSSQL Type Constants: String --

export const TypeChar = 'char'
export const TypeVarchar = 'varchar'
export const TypeNChar = 'nchar'
export const TypeNVarchar = 'nvarchar'
export const TypeText = 'text'
export const TypeNText = 'ntext'

// -- MSSQL Type Constants: Binary --

export const TypeBinary = 'binary'
export const TypeVarBinary = 'varbinary'
export const TypeImage = 'image'

// -- MSSQL Type Constants: Date/Time --

export const TypeDate = 'date'
export const TypeTime = 'time'
export const TypeDateTime = 'datetime'
export const TypeDateTime2 = 'datetime2'
export const TypeSmallDateTime = 'smalldatetime'
export const TypeDateTimeOffset = 'datetimeoffset'

// -- MSSQL Type Constants: Other --

export const TypeUniqueIdentifier = 'uniqueidentifier'
export const TypeXml = 'xml'
export const TypeSqlVariant = 'sql_variant'
export const TypeHierarchyId = 'hierarchyid'
export const TypeGeometry = 'geometry'
export const TypeGeography = 'geography'
export const TypeTimestamp = 'timestamp'
export const TypeRowVersion = 'rowversion'
export const TypeSysname = 'sysname'

// -- Index Type Constants --

export const IndexTypeClustered = 'CLUSTERED'
export const IndexTypeNonclustered = 'NONCLUSTERED'
export const IndexTypeColumnstore = 'COLUMNSTORE'

// -- Version Constants --

export const MSSQL2012 = 11
export const MSSQL2016 = 13
export const MSSQL2017 = 14
export const MSSQL2019 = 15
export const MSSQL2022 = 16

// -- System Schemas --

export const systemSchemas = [
  'sys',
  'INFORMATION_SCHEMA',
  'guest',
  'db_owner',
  'db_accessadmin',
  'db_securityadmin',
  'db_ddladmin',
  'db_backupoperator',
  'db_datareader',
  'db_datawriter',
  'db_denydatareader',
  'db_denydatawriter',
]

// -- SQL Queries --

export const schemasQuery = `
SELECT s.schema_id, s.name
FROM sys.schemas s
WHERE s.name NOT IN (
  'sys', 'INFORMATION_SCHEMA', 'guest',
  'db_owner', 'db_accessadmin', 'db_securityadmin', 'db_ddladmin',
  'db_backupoperator', 'db_datareader', 'db_datawriter',
  'db_denydatareader', 'db_denydatawriter'
)
ORDER BY s.name`

export const schemasQueryArgs = `
SELECT s.schema_id, s.name
FROM sys.schemas s
WHERE s.name %s
ORDER BY s.name`

export const tablesQuery = `
SELECT
  s.name AS schema_name,
  t.name AS table_name,
  t.object_id,
  CAST(ep.value AS NVARCHAR(MAX)) AS table_comment
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.extended_properties ep
  ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
WHERE s.name IN (%s)
ORDER BY s.name, t.name`

export const columnsQuery = `
SELECT
  t.name AS table_name,
  c.name AS column_name,
  tp.name AS type_name,
  c.max_length,
  c.precision,
  c.scale,
  c.is_nullable,
  c.is_identity,
  c.is_computed,
  dc.definition AS default_def,
  cc.definition AS computed_def,
  cc.is_persisted,
  CAST(ep.value AS NVARCHAR(MAX)) AS column_comment,
  ic.seed_value,
  ic.increment_value,
  c.collation_name
FROM sys.columns c
JOIN sys.tables t ON c.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.types tp ON c.user_type_id = tp.user_type_id
LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
LEFT JOIN sys.computed_columns cc ON c.object_id = cc.object_id AND c.column_id = cc.column_id
LEFT JOIN sys.extended_properties ep
  ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
LEFT JOIN sys.identity_columns ic ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE s.name = ? AND t.name IN (%s)
ORDER BY t.name, c.column_id`

export const indexesQuery = `
SELECT
  t.name AS table_name,
  i.name AS index_name,
  i.type AS index_type,
  i.is_unique,
  i.is_primary_key,
  i.is_unique_constraint,
  i.filter_definition,
  ic.key_ordinal,
  ic.is_descending_key,
  ic.is_included_column,
  c.name AS column_name,
  ISNULL(kc.is_system_named, 0) AS is_system_named
FROM sys.indexes i
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.key_constraints kc ON i.object_id = kc.parent_object_id AND i.index_id = kc.unique_index_id
WHERE s.name = ? AND t.name IN (%s) AND i.type <> 0
ORDER BY t.name, i.index_id, ic.key_ordinal, ic.index_column_id`

export const foreignKeysQuery = `
SELECT
  fk.name AS fk_name,
  fk.is_system_named,
  pt.name AS table_name,
  pc.name AS column_name,
  SCHEMA_NAME(rt.schema_id) AS ref_schema,
  rt.name AS ref_table,
  rc.name AS ref_column,
  fk.update_referential_action_desc,
  fk.delete_referential_action_desc
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
JOIN sys.tables pt ON fk.parent_object_id = pt.object_id
JOIN sys.schemas ps ON pt.schema_id = ps.schema_id
JOIN sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
WHERE ps.name = ? AND pt.name IN (%s)
ORDER BY pt.name, fk.name, fkc.constraint_column_id`

export const checksQuery = `
SELECT
  t.name AS table_name,
  cc.name AS check_name,
  cc.definition,
  cc.is_system_named
FROM sys.check_constraints cc
JOIN sys.tables t ON cc.parent_object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = ? AND t.name IN (%s)
ORDER BY t.name, cc.name`

export const viewsQuery = `
SELECT
  s.name AS schema_name,
  v.name AS view_name,
  v.object_id,
  m.definition,
  CAST(ep.value AS NVARCHAR(MAX)) AS view_comment,
  OBJECTPROPERTY(v.object_id, 'IsSchemaBound') AS is_schema_bound
FROM sys.views v
JOIN sys.schemas s ON v.schema_id = s.schema_id
LEFT JOIN sys.sql_modules m ON v.object_id = m.object_id
LEFT JOIN sys.extended_properties ep
  ON ep.major_id = v.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
WHERE s.name IN (%s)
ORDER BY s.name, v.name`

export const triggersQuery = `
SELECT
  t.name AS trigger_name,
  OBJECT_NAME(t.parent_id) AS table_name,
  SCHEMA_NAME(o.schema_id) AS schema_name,
  m.definition AS body,
  te.type_desc AS event_type,
  OBJECTPROPERTY(t.object_id, 'ExecIsAfterTrigger') AS is_after,
  OBJECTPROPERTY(t.object_id, 'ExecIsInsteadOfTrigger') AS is_instead_of,
  t.is_disabled
FROM sys.triggers t
JOIN sys.objects o ON t.parent_id = o.object_id
JOIN sys.sql_modules m ON t.object_id = m.object_id
JOIN sys.trigger_events te ON t.object_id = te.object_id
WHERE SCHEMA_NAME(o.schema_id) IN (%s)
ORDER BY schema_name, table_name, trigger_name`

export const funcsQuery = `
SELECT
  s.name AS schema_name,
  o.name AS routine_name,
  o.type AS routine_type,
  m.definition AS body,
  TYPE_NAME(p_ret.user_type_id) AS return_type
FROM sys.objects o
JOIN sys.schemas s ON o.schema_id = s.schema_id
JOIN sys.sql_modules m ON o.object_id = m.object_id
LEFT JOIN sys.parameters p_ret ON o.object_id = p_ret.object_id AND p_ret.parameter_id = 0
WHERE o.type IN ('FN', 'IF', 'TF', 'P')
  AND s.name IN (%s)
ORDER BY s.name, o.type, o.name`

export const paramsQuery = `
SELECT
  SCHEMA_NAME(o.schema_id) AS schema_name,
  o.name AS routine_name,
  p.parameter_id,
  p.name AS param_name,
  TYPE_NAME(p.user_type_id) AS type_name,
  p.max_length,
  p.precision,
  p.scale,
  p.is_output
FROM sys.parameters p
JOIN sys.objects o ON p.object_id = o.object_id
WHERE o.type IN ('FN', 'IF', 'TF', 'P')
  AND SCHEMA_NAME(o.schema_id) IN (%s)
  AND p.parameter_id > 0
ORDER BY schema_name, routine_name, p.parameter_id`

export const sequencesQuery = `
SELECT
  s.name AS schema_name,
  seq.name AS sequence_name,
  TYPE_NAME(seq.user_type_id) AS type_name,
  CAST(seq.start_value AS BIGINT) AS start_value,
  CAST(seq.increment AS BIGINT) AS increment,
  CAST(seq.minimum_value AS BIGINT) AS min_value,
  CAST(seq.maximum_value AS BIGINT) AS max_value,
  seq.is_cycling,
  CAST(seq.cache_size AS INT) AS cache_size
FROM sys.sequences seq
JOIN sys.schemas s ON seq.schema_id = s.schema_id
WHERE s.name IN (%s)
ORDER BY s.name, seq.name`

// -- Helper: generate N placeholders --

/** Returns N question-mark placeholders joined by commas. */
export function nArgs(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ')
}

// -- Helper: Unicode type check --

/** Returns true for types where max_length is in bytes (2 per character). */
export function isUnicodeType(typeName: string): boolean {
  const t = typeName.toLowerCase()
  return t === TypeNChar || t === TypeNVarchar || t === TypeNText
}

// -- Helper: Type has max length --

/** Returns true for types where the (n) size specifier is meaningful. */
export function typeHasMaxLength(typeName: string): boolean {
  const t = typeName.toLowerCase()
  return (
    t === TypeChar ||
    t === TypeVarchar ||
    t === TypeNChar ||
    t === TypeNVarchar ||
    t === TypeBinary ||
    t === TypeVarBinary
  )
}

// -- Helper: Type has precision and scale --

/** Returns true for types that accept (precision, scale) specifiers. */
export function typeHasPrecisionScale(typeName: string): boolean {
  const t = typeName.toLowerCase()
  return t === TypeDecimal || t === TypeNumeric
}

// -- Helper: Type has scale (fractional seconds) --

/** Returns true for time types where scale represents fractional seconds precision. */
export function typeHasScale(typeName: string): boolean {
  const t = typeName.toLowerCase()
  return t === TypeTime || t === TypeDateTime2 || t === TypeDateTimeOffset
}

// -- Type Parsing --

/**
 * Parse MSSQL type info from sys.columns into a SchemaType.
 * Takes the type name, max_length (bytes), precision, and scale from the catalog.
 */
export function parseType(typeName: string, maxLength: number, precision: number, scale: number): SchemaType {
  const t = typeName.toLowerCase()

  switch (t) {
    case TypeBit:
      return { kind: 'boolean', T: TypeBit }

    case TypeTinyInt:
    case TypeSmallInt:
    case TypeInt:
    case TypeBigInt:
      return { kind: 'integer', T: t }

    case TypeDecimal:
    case TypeNumeric: {
      const dt: SchemaType = { kind: 'decimal', T: t }
      if (precision) (dt as any).precision = precision
      if (scale) (dt as any).scale = scale
      return dt
    }

    case TypeMoney:
    case TypeSmallMoney:
      return { kind: 'decimal', T: t }

    case TypeFloat:
    case TypeReal: {
      const ft: SchemaType = { kind: 'float', T: t }
      // float default precision is 53, real is 24 — only include if non-default
      if (t === TypeFloat && precision && precision !== 53) (ft as any).precision = precision
      if (t === TypeReal && precision && precision !== 24) (ft as any).precision = precision
      return ft
    }

    case TypeChar:
    case TypeVarchar: {
      const st: SchemaType = { kind: 'string', T: t }
      if (maxLength === -1) {
        ;(st as any).size = -1
      } else if (maxLength > 0) {
        ;(st as any).size = maxLength
      }
      return st
    }

    case TypeNChar:
    case TypeNVarchar: {
      const st: SchemaType = { kind: 'string', T: t }
      if (maxLength === -1) {
        ;(st as any).size = -1
      } else if (maxLength > 0) {
        // nchar/nvarchar store 2 bytes per character
        ;(st as any).size = maxLength / 2
      }
      return st
    }

    case TypeText:
    case TypeNText:
      return { kind: 'string', T: t }

    case TypeBinary:
    case TypeVarBinary: {
      const bt: SchemaType = { kind: 'binary', T: t }
      if (maxLength === -1) {
        ;(bt as any).size = -1
      } else if (maxLength > 0) {
        ;(bt as any).size = maxLength
      }
      return bt
    }

    case TypeImage:
      return { kind: 'binary', T: TypeImage }

    case TypeDate:
    case TypeDateTime:
    case TypeSmallDateTime:
      return { kind: 'time', T: t }

    case TypeTime:
    case TypeDateTime2:
    case TypeDateTimeOffset: {
      const tt: SchemaType = { kind: 'time', T: t }
      if (scale) (tt as any).precision = scale
      return tt
    }

    case TypeUniqueIdentifier:
      return { kind: 'uuid', T: TypeUniqueIdentifier }

    case TypeXml:
      return { kind: 'string', T: TypeXml }

    case TypeGeometry:
    case TypeGeography:
      return { kind: 'spatial', T: t }

    case TypeHierarchyId:
      return { kind: 'unsupported', T: TypeHierarchyId }

    case TypeSqlVariant:
      return { kind: 'unsupported', T: TypeSqlVariant }

    case TypeSysname:
      // sysname is an alias for nvarchar(128)
      return { kind: 'string', T: TypeNVarchar, size: 128 }

    case TypeTimestamp:
    case TypeRowVersion:
      // timestamp and rowversion are the same binary type
      return { kind: 'binary', T: TypeRowVersion }

    default:
      return { kind: 'unsupported', T: t }
  }
}

// -- Type Formatting --

/**
 * Format MSSQL type info back to its DDL string representation.
 * Takes the type name, max_length (bytes), precision, and scale from the catalog.
 */
export function formatTypeSpec(typeName: string, maxLength: number, precision: number, scale: number): string {
  const t = typeName.toLowerCase()

  // Types with (max) or (n) size specifier
  if (typeHasMaxLength(t)) {
    if (maxLength === -1) return `${t}(max)`
    const displaySize = isUnicodeType(t) ? maxLength / 2 : maxLength
    if (displaySize > 0) return `${t}(${displaySize})`
    return t
  }

  // Types with (precision, scale)
  if (typeHasPrecisionScale(t)) {
    if (precision && scale) return `${t}(${precision},${scale})`
    if (precision) return `${t}(${precision})`
    return t
  }

  // Time types with fractional seconds precision (stored in scale)
  if (typeHasScale(t)) {
    if (scale) return `${t}(${scale})`
    return t
  }

  // float with explicit precision
  if (t === TypeFloat && precision && precision !== 53) {
    return `${t}(${precision})`
  }

  return t
}

// -- Reference Action Parsing --

/**
 * Convert MSSQL referential action descriptors to standard form.
 * MSSQL uses underscores (e.g. NO_ACTION) while standard SQL uses spaces.
 */
export function parseReferenceAction(actionDesc: string): ReferenceAction {
  switch (actionDesc) {
    case 'NO_ACTION':
      return 'NO ACTION'
    case 'CASCADE':
      return 'CASCADE'
    case 'SET_NULL':
      return 'SET NULL'
    case 'SET_DEFAULT':
      return 'SET DEFAULT'
    default:
      return actionDesc.replace(/_/g, ' ') as ReferenceAction
  }
}

// -- Statement Scanner --

/**
 * MSSQL statement scanner that handles GO batch separators.
 * Splits on GO lines first, then uses Scanner to split individual statements on semicolons.
 */
export function mssqlScanStmts(input: string): Stmt[] {
  const scanner = new Scanner({
    matchBegin: true,
    matchBeginTryCatch: true,
    goCommand: true,
    beginEndTerminator: true,
    // MSSQL does NOT support these:
    matchBeginAtomic: false,
    matchDollarQuote: false,
    backslashEscapes: false,
    hashComments: false,
  })
  return scanner.scan(input)
}

// -- Version Parsing --

/**
 * Parse MSSQL version string from SERVERPROPERTY('ProductVersion').
 * Returns the major version number (e.g. 16 for SQL Server 2022).
 * Version strings are formatted like '16.0.1000.6'.
 */
export function parseVersion(versionStr: string): number {
  const dot = versionStr.indexOf('.')
  if (dot === -1) return parseInt(versionStr, 10)
  return parseInt(versionStr.slice(0, dot), 10)
}
