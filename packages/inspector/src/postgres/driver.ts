// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/postgres/driver_oss.go, sql/postgres/convert.go

import type {
  ArrayType,
  BinaryType,
  BoolType,
  CurrencyType,
  DecimalType,
  DomainType,
  EnumType,
  FloatType,
  IntegerType,
  IntervalType,
  JSONType,
  NetworkType,
  RangeType,
  SchemaType,
  SerialType,
  SpatialType,
  StringType,
  TextSearchType,
  TimeType,
  UnsupportedType,
  UUIDType,
} from '../schema/schema.ts'

// -- Standard PostgreSQL column types and their aliases --

export const TypeBit = 'bit'
export const TypeBitVar = 'bit varying'
export const TypeBoolean = 'boolean'
export const TypeBool = 'bool'
export const TypeBytea = 'bytea'

export const TypeCharacter = 'character'
export const TypeChar = 'char'
export const TypeCharVar = 'character varying'
export const TypeVarChar = 'varchar'
export const TypeText = 'text'
export const TypeBPChar = 'bpchar'
export const TypeName = 'name'

export const TypeSmallInt = 'smallint'
export const TypeInteger = 'integer'
export const TypeBigInt = 'bigint'
export const TypeInt = 'int'
export const TypeInt2 = 'int2'
export const TypeInt4 = 'int4'
export const TypeInt8 = 'int8'
export const TypeInt64 = 'int64'

export const TypeXID = 'xid'
export const TypeXID8 = 'xid8'

export const TypeCIDR = 'cidr'
export const TypeInet = 'inet'
export const TypeMACAddr = 'macaddr'
export const TypeMACAddr8 = 'macaddr8'

export const TypeCircle = 'circle'
export const TypeLine = 'line'
export const TypeLseg = 'lseg'
export const TypeBox = 'box'
export const TypePath = 'path'
export const TypePolygon = 'polygon'
export const TypePoint = 'point'
export const TypeGeometry = 'geometry'

export const TypeDate = 'date'
export const TypeTime = 'time'
export const TypeTimeTZ = 'timetz'
export const TypeTimeWTZ = 'time with time zone'
export const TypeTimeWOTZ = 'time without time zone'
export const TypeTimestamp = 'timestamp'
export const TypeTimestampTZ = 'timestamptz'
export const TypeTimestampWTZ = 'timestamp with time zone'
export const TypeTimestampWOTZ = 'timestamp without time zone'

export const TypeDouble = 'double precision'
export const TypeReal = 'real'
export const TypeFloat8 = 'float8'
export const TypeFloat4 = 'float4'
export const TypeFloat = 'float'

export const TypeNumeric = 'numeric'
export const TypeDecimal = 'decimal'

export const TypeSmallSerial = 'smallserial'
export const TypeSerial = 'serial'
export const TypeBigSerial = 'bigserial'
export const TypeSerial2 = 'serial2'
export const TypeSerial4 = 'serial4'
export const TypeSerial8 = 'serial8'

export const TypeArray = 'array'
export const TypeXML = 'xml'
export const TypeJSON = 'json'
export const TypeJSONB = 'jsonb'
export const TypeUUID = 'uuid'
export const TypeMoney = 'money'
export const TypeInterval = 'interval'
export const TypeTSQuery = 'tsquery'
export const TypeTSVector = 'tsvector'
export const TypeUserDefined = 'user-defined'

export const TypeInt4Range = 'int4range'
export const TypeInt4MultiRange = 'int4multirange'
export const TypeInt8Range = 'int8range'
export const TypeInt8MultiRange = 'int8multirange'
export const TypeNumRange = 'numrange'
export const TypeNumMultiRange = 'nummultirange'
export const TypeTSRange = 'tsrange'
export const TypeTSMultiRange = 'tsmultirange'
export const TypeTSTZRange = 'tstzrange'
export const TypeTSTZMultiRange = 'tstzmultirange'
export const TypeDateRange = 'daterange'
export const TypeDateMultiRange = 'datemultirange'

// PostgreSQL internal object types
export const TypeOID = 'oid'
export const TypeRegClass = 'regclass'
export const TypeRegCollation = 'regcollation'
export const TypeRegConfig = 'regconfig'
export const TypeRegDictionary = 'regdictionary'
export const TypeRegNamespace = 'regnamespace'
export const TypeRegOper = 'regoper'
export const TypeRegOperator = 'regoperator'
export const TypeRegProc = 'regproc'
export const TypeRegProcedure = 'regprocedure'
export const TypeRegRole = 'regrole'
export const TypeRegType = 'regtype'

// PostgreSQL pseudo-types
export const TypeAny = 'any'
export const TypeAnyElement = 'anyelement'
export const TypeAnyArray = 'anyarray'
export const TypeAnyNonArray = 'anynonarray'
export const TypeAnyEnum = 'anyenum'
export const TypeInternal = 'internal'
export const TypeRecord = 'record'
export const TypeTrigger = 'trigger'
export const TypeEventTrigger = 'event_trigger'
export const TypeVoid = 'void'
export const TypeUnknown = 'unknown'

// Index types
export const IndexTypeBTree = 'BTREE'
export const IndexTypeBRIN = 'BRIN'
export const IndexTypeHash = 'HASH'
export const IndexTypeGIN = 'GIN'
export const IndexTypeGiST = 'GIST'
export const IndexTypeSPGiST = 'SPGIST'

// Generated types
export const GeneratedTypeAlways = 'ALWAYS'
export const GeneratedTypeByDefault = 'BY_DEFAULT'

// Partition types
export const PartitionTypeRange = 'RANGE'
export const PartitionTypeList = 'LIST'
export const PartitionTypeHash = 'HASH'

// Default time precision for PostgreSQL
const defaultTimePrecision = 6

// -- Query Constants --
// These SQL queries are copied exactly from the Go source (driver_oss.go, inspect_oss.go).

/** Query to list runtime parameters. */
export const paramsQuery = `SELECT current_setting('server_version_num'), current_setting('default_table_access_method', true), current_setting('crdb_version', true)`

/** Query to list database schemas. */
export const schemasQuery = `
SELECT
	nspname AS schema_name,
	pg_catalog.obj_description(ns.oid) AS comment
FROM
	pg_catalog.pg_namespace ns
	LEFT JOIN pg_depend AS dep ON dep.classid = 'pg_catalog.pg_namespace'::regclass::oid AND dep.objid = ns.oid AND dep.deptype = 'e'
WHERE
	nspname NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'crdb_internal', 'pg_extension')
	AND nspname NOT LIKE 'pg_%temp_%'
	AND dep.objid IS NULL
ORDER BY
    nspname`

/** Query to list database schemas filtered by name. */
export const schemasQueryArgs = `
SELECT
	nspname AS schema_name,
	pg_catalog.obj_description(ns.oid) AS comment
FROM
	pg_catalog.pg_namespace ns
	LEFT JOIN pg_depend AS dep ON dep.classid = 'pg_catalog.pg_namespace'::regclass::oid AND dep.objid = ns.oid AND dep.deptype = 'e'
WHERE
	nspname %s
	AND dep.objid IS NULL
ORDER BY
    nspname`

/** Query to list tables information. */
export const tablesQuery = `
SELECT
	t3.oid,
	t1.table_schema,
	t1.table_name,
	pg_catalog.obj_description(t3.oid, 'pg_class') AS comment,
	t4.partattrs AS partition_attrs,
	t4.partstrat AS partition_strategy,
	pg_get_expr(t4.partexprs, t4.partrelid) AS partition_exprs,
	'{}' AS attrs,
	t3.relrowsecurity,
	t3.relforcerowsecurity
FROM
	INFORMATION_SCHEMA.TABLES AS t1
	JOIN pg_catalog.pg_namespace AS t2 ON t2.nspname = t1.table_schema
	JOIN pg_catalog.pg_class AS t3 ON t3.relnamespace = t2.oid AND t3.relname = t1.table_name
	LEFT JOIN pg_catalog.pg_partitioned_table AS t4 ON t4.partrelid = t3.oid
	LEFT JOIN pg_depend AS t5 ON t5.classid = 'pg_catalog.pg_class'::regclass::oid AND t5.objid = t3.oid AND t5.deptype = 'e'
WHERE
	t1.table_type = 'BASE TABLE'
	AND NOT COALESCE(t3.relispartition, false)
	AND t1.table_schema IN (%s)
	AND t5.objid IS NULL
ORDER BY
	t1.table_schema, t1.table_name
`

/** Query to list tables by their names. */
export const tablesQueryArgs = `
SELECT
	t3.oid,
	t1.table_schema,
	t1.table_name,
	pg_catalog.obj_description(t3.oid, 'pg_class') AS comment,
	t4.partattrs AS partition_attrs,
	t4.partstrat AS partition_strategy,
	pg_get_expr(t4.partexprs, t4.partrelid) AS partition_exprs,
	'{}' AS attrs,
	t3.relrowsecurity,
	t3.relforcerowsecurity
FROM
	INFORMATION_SCHEMA.TABLES AS t1
	JOIN pg_catalog.pg_namespace AS t2 ON t2.nspname = t1.table_schema
	JOIN pg_catalog.pg_class AS t3 ON t3.relnamespace = t2.oid AND t3.relname = t1.table_name
	LEFT JOIN pg_catalog.pg_partitioned_table AS t4 ON t4.partrelid = t3.oid
	LEFT JOIN pg_depend AS t5 ON t5.classid = 'pg_catalog.pg_class'::regclass::oid AND t5.objid = t3.oid AND t5.deptype = 'e'
WHERE
	t1.table_type = 'BASE TABLE'
	AND NOT COALESCE(t3.relispartition, false)
	AND t1.table_schema IN (%s)
	AND t1.table_name IN (%s)
	AND t5.objid IS NULL
ORDER BY
	t1.table_schema, t1.table_name
`

/** Query to list table columns. */
export const columnsQuery = `
SELECT
	t1.table_schema,
	t1.table_name,
	t1.column_name,
	t1.data_type,
	pg_catalog.format_type(a.atttypid, a.atttypmod) AS format_type,
	t1.is_nullable,
	t1.column_default,
	t1.character_maximum_length,
	t1.numeric_precision,
	t1.datetime_precision,
	t1.numeric_scale,
	t1.interval_type,
	t1.character_set_name,
	t1.collation_name,
	t1.is_identity,
	t1.identity_start,
	t1.identity_increment,
	(CASE WHEN t1.is_identity = 'YES' THEN (SELECT last_value FROM pg_sequences WHERE quote_ident(schemaname) || '.' || quote_ident(sequencename) = pg_get_serial_sequence(quote_ident(t1.table_schema) || '.' || quote_ident(t1.table_name), t1.column_name)) END) AS identity_last,
	t1.identity_generation,
	t1.generation_expression,
	col_description(t3.oid, "ordinal_position") AS comment,
	t4.typtype,
	t4.typelem,
	t4.oid,
	a.attnum
FROM
	"information_schema"."columns" AS t1
	JOIN pg_catalog.pg_namespace AS t2 ON t2.nspname = t1.table_schema
	JOIN pg_catalog.pg_class AS t3 ON t3.relnamespace = t2.oid AND t3.relname = t1.table_name
	JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t3.oid AND a.attname = t1.column_name
	LEFT JOIN pg_catalog.pg_type AS t4 ON t4.oid = a.atttypid
WHERE
	t1.table_schema IN (%s) AND t1.table_name IN (%s)
ORDER BY
	t1.table_schema, t1.table_name, t1.ordinal_position
`

/** Index query template (parametrized for different PG versions). */
const indexesQueryTmpl = `
SELECT
	n.nspname AS schema_name,
	t.relname AS table_name,
	i.relname AS index_name,
	am.amname AS index_type,
	a.attname AS column_name,
	%INCLUDED% AS included,
	idx.indisprimary AS primary,
	idx.indisunique AS unique,
	(CASE WHEN idx.indisexclusion THEN (SELECT conexclop[idx.ord]::regoper FROM pg_constraint WHERE conindid = idx.indexrelid) END) AS excoper,
	con.nametypes AS constraints,
	pg_get_expr(idx.indpred, idx.indrelid) AS predicate,
	pg_get_indexdef(idx.indexrelid, idx.ord, false) AS expression,
	pg_index_column_has_property(idx.indexrelid, idx.ord, 'desc') AS isdesc,
	pg_index_column_has_property(idx.indexrelid, idx.ord, 'nulls_first') AS nulls_first,
	pg_index_column_has_property(idx.indexrelid, idx.ord, 'nulls_last') AS nulls_last,
	obj_description(i.oid, 'pg_class') AS comment,
	i.reloptions AS options,
	op.opcname AS opclass_name,
	op.opcnamespace::regnamespace::text AS opclass_schema,
	op.opcdefault AS opclass_default,
	a2.attoptions AS opclass_params,
    %NULLSDISTINCT% AS indnullsnotdistinct
FROM
	(
		select
			*,
			generate_series(1,array_length(i.indkey,1)) as ord,
			unnest(i.indkey) AS key
		from pg_index i
	) idx
	JOIN pg_class i ON i.oid = idx.indexrelid
	JOIN pg_class t ON t.oid = idx.indrelid
	JOIN pg_namespace n ON n.oid = t.relnamespace
	LEFT JOIN (
	    select conindid, jsonb_object_agg(conname, contype) AS nametypes
	    from pg_constraint
	    group by conindid
	) con ON con.conindid = idx.indexrelid
	LEFT JOIN pg_attribute a ON (a.attrelid, a.attnum) = (idx.indrelid, idx.key)
	JOIN pg_am am ON am.oid = i.relam
	LEFT JOIN pg_opclass op ON op.oid = idx.indclass[idx.ord-1]
	LEFT JOIN pg_attribute a2 ON (a2.attrelid, a2.attnum) = (idx.indexrelid, idx.ord)
WHERE
	n.nspname IN (%s)
	AND t.relname IN (%s)
ORDER BY
	n.nspname, table_name, index_name, idx.ord
`

/** Index query for PG < 11 (no INCLUDE, no NULLS DISTINCT). */
export const indexesBelow11 = indexesQueryTmpl.replace('%INCLUDED%', 'false').replace('%NULLSDISTINCT%', 'false')

/** Index query for PG >= 11 (has INCLUDE, no NULLS DISTINCT). */
export const indexesAbove11 = indexesQueryTmpl
  .replace('%INCLUDED%', "(a.attname <> '' AND idx.indnatts > idx.indnkeyatts AND idx.ord > idx.indnkeyatts)")
  .replace('%NULLSDISTINCT%', 'false')

/** Index query for PG >= 15 (has INCLUDE and NULLS DISTINCT). */
export const indexesAbove15 = indexesQueryTmpl
  .replace('%INCLUDED%', "(a.attname <> '' AND idx.indnatts > idx.indnkeyatts AND idx.ord > idx.indnkeyatts)")
  .replace('%NULLSDISTINCT%', 'idx.indnullsnotdistinct')

/** Query to list foreign-keys. */
export const fksQuery = `
SELECT
    fk.constraint_name,
    fk.table_name,
    a1.attname AS column_name,
    fk.schema_name,
    fk.referenced_table_name,
    a2.attname AS referenced_column_name,
    fk.referenced_schema_name,
    fk.confupdtype,
    fk.confdeltype
	FROM
	    (
	    	SELECT
	      		con.conname AS constraint_name,
	      		con.conrelid,
	      		con.confrelid,
	      		t1.relname AS table_name,
	      		ns1.nspname AS schema_name,
      			t2.relname AS referenced_table_name,
	      		ns2.nspname AS referenced_schema_name,
	      		generate_series(1,array_length(con.conkey,1)) as ord,
	      		unnest(con.conkey) AS conkey,
	      		unnest(con.confkey) AS confkey,
	      		con.confupdtype,
	      		con.confdeltype
	    	FROM pg_constraint con
	    	JOIN pg_class t1 ON t1.oid = con.conrelid
	    	JOIN pg_class t2 ON t2.oid = con.confrelid
	    	JOIN pg_namespace ns1 on t1.relnamespace = ns1.oid
	    	JOIN pg_namespace ns2 on t2.relnamespace = ns2.oid
	    	WHERE ns1.nspname IN (%s)
	    	AND t1.relname IN (%s)
	    	AND con.contype = 'f'
	) AS fk
	JOIN pg_attribute a1 ON a1.attnum = fk.conkey AND a1.attrelid = fk.conrelid
	JOIN pg_attribute a2 ON a2.attnum = fk.confkey AND a2.attrelid = fk.confrelid
	ORDER BY
	    fk.conrelid, fk.constraint_name, fk.ord
`

/** Query to list table check constraints. */
export const checksQuery = `
SELECT
	nsp.nspname AS schema_name,
	rel.relname AS table_name,
	t1.conname AS constraint_name,
	pg_get_expr(t1.conbin, t1.conrelid) as expression,
	t2.attname as column_name,
	t1.conkey as column_indexes,
	t1.connoinherit as no_inherit
FROM
	pg_constraint t1
	JOIN pg_attribute t2
	ON t2.attrelid = t1.conrelid
	AND t2.attnum = ANY (t1.conkey)
	JOIN pg_class rel
	ON rel.oid = t1.conrelid
	JOIN pg_namespace nsp
	ON nsp.oid = t1.connamespace
WHERE
	t1.contype = 'c'
	AND nsp.nspname IN (%s)
	AND rel.relname IN (%s)
ORDER BY
	t1.conname, array_position(t1.conkey, t2.attnum)
`

/** Query to list enum values. */
export const enumsQuery = `
SELECT
	n.nspname AS schema_name,
	e.enumtypid AS enum_id,
	t.typname AS enum_name,
	e.enumlabel AS enum_value
FROM
	pg_enum e
	JOIN pg_type t ON e.enumtypid = t.oid
	JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE
    n.nspname IN (%s)
ORDER BY
    n.nspname, e.enumtypid, e.enumsortorder
`

/** Query to list views (regular and materialized). */
export const viewsQuery = `
SELECT
	n.nspname AS schema_name,
	c.relname AS view_name,
	pg_get_viewdef(c.oid, true) AS definition,
	c.relkind = 'm' AS is_materialized
FROM
	pg_catalog.pg_class c
	JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
	LEFT JOIN pg_depend d ON d.classid = 'pg_catalog.pg_class'::regclass::oid AND d.objid = c.oid AND d.deptype = 'e'
WHERE
	c.relkind IN ('v', 'm')
	AND n.nspname IN (%s)
	AND d.objid IS NULL
ORDER BY
	n.nspname, c.relname
`

/** Query to list view columns via pg_attribute. */
export const viewColumnsQuery = `
SELECT
	n.nspname AS schema_name,
	c.relname AS view_name,
	a.attname AS column_name,
	pg_catalog.format_type(a.atttypid, a.atttypmod) AS column_type,
	NOT a.attnotnull AS is_nullable
FROM
	pg_catalog.pg_class c
	JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
	JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE
	c.relkind IN ('v', 'm')
	AND n.nspname IN (%s)
ORDER BY
	n.nspname, c.relname, a.attnum
`

/** Query to list functions and procedures. */
export const funcsQuery = `
SELECT
	n.nspname AS schema_name,
	p.proname AS func_name,
	p.prokind AS kind,
	pg_get_functiondef(p.oid) AS definition,
	l.lanname AS lang,
	CASE WHEN p.prokind = 'f' THEN pg_catalog.pg_get_function_result(p.oid) ELSE '' END AS return_type,
	COALESCE(pg_catalog.pg_get_function_arguments(p.oid), '') AS func_args
FROM
	pg_catalog.pg_proc p
	JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
	JOIN pg_catalog.pg_language l ON l.oid = p.prolang
	LEFT JOIN pg_depend d ON d.classid = 'pg_catalog.pg_proc'::regclass::oid AND d.objid = p.oid AND d.deptype = 'e'
WHERE
	p.prokind IN ('f', 'p')
	AND n.nspname IN (%s)
	AND d.objid IS NULL
ORDER BY
	n.nspname, p.proname
`

/** Query to list triggers using pg_get_triggerdef for full DDL. */
export const triggersQuery = `
SELECT
	n.nspname AS schema_name,
	t.tgname AS trigger_name,
	c.relname AS table_name,
	CASE t.tgtype::int & 66
		WHEN 2  THEN 'BEFORE'
		WHEN 64 THEN 'INSTEAD OF'
		ELSE 'AFTER'
	END AS action_timing,
	array_to_string(ARRAY[
		CASE WHEN t.tgtype::int & 4  != 0 THEN 'INSERT'   END,
		CASE WHEN t.tgtype::int & 8  != 0 THEN 'DELETE'   END,
		CASE WHEN t.tgtype::int & 16 != 0 THEN 'UPDATE'   END,
		CASE WHEN t.tgtype::int & 32 != 0 THEN 'TRUNCATE' END
	], ' OR ') AS event_manipulation,
	CASE WHEN t.tgtype::int & 1 != 0 THEN 'ROW' ELSE 'STATEMENT' END AS orientation,
	pg_get_triggerdef(t.oid) AS definition
FROM
	pg_catalog.pg_trigger t
	JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
	JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE
	NOT t.tgisinternal
	AND n.nspname IN (%s)
ORDER BY
	n.nspname, c.relname, t.tgname
`

/** Query to list domain types. */
export const domainsQuery = `
SELECT
	n.nspname AS schema_name,
	t.typname AS type_name,
	pg_catalog.format_type(t.typbasetype, t.typtypmod) AS base_type,
	t.typnotnull AS not_null,
	pg_catalog.pg_get_expr(t.typdefaultbin, 0) AS default_value
FROM
	pg_catalog.pg_type t
	JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE
	t.typtype = 'd'
	AND n.nspname IN (%s)
ORDER BY
	n.nspname, t.typname
`

/** Query to list check constraints on domain types. */
export const domainChecksQuery = `
SELECT
	n.nspname AS schema_name,
	t.typname AS type_name,
	c.conname AS constraint_name,
	pg_catalog.pg_get_constraintdef(c.oid) AS check_expr
FROM
	pg_catalog.pg_constraint c
	JOIN pg_catalog.pg_type t ON t.oid = c.contypid
	JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE
	c.contype = 'c'
	AND t.typtype = 'd'
	AND n.nspname IN (%s)
ORDER BY
	n.nspname, t.typname, c.conname
`

/** Query to list composite types and their fields. */
export const compositesQuery = `
SELECT
	n.nspname AS schema_name,
	t.typname AS type_name,
	a.attname AS field_name,
	pg_catalog.format_type(a.atttypid, a.atttypmod) AS field_type
FROM
	pg_catalog.pg_type t
	JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
	JOIN pg_catalog.pg_class c ON c.oid = t.typrelid
	JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE
	t.typtype = 'c'
	AND n.nspname IN (%s)
	AND NOT EXISTS (
		SELECT 1 FROM pg_catalog.pg_class r
		WHERE r.oid = t.typrelid AND r.relkind IN ('r', 'v', 'm', 'p')
	)
	-- Exclude extension-owned types (e.g., tablefunc's crosstab types).
	AND NOT EXISTS (
		SELECT 1 FROM pg_catalog.pg_depend d
		WHERE d.objid = t.oid AND d.deptype = 'e'
	)
ORDER BY
	n.nspname, t.typname, a.attnum
`

/** Query to list independent sequences (not owned by any column). */
export const sequencesQuery = `
SELECT
	n.nspname AS schema_name,
	c.relname AS sequence_name,
	pg_catalog.format_type(s.seqtypid, NULL) AS data_type,
	s.seqstart AS start_value,
	s.seqincrement AS increment,
	s.seqcache AS cache_size,
	s.seqmin AS min_value,
	s.seqmax AS max_value,
	s.seqcycle AS cycle,
	d_table.relname AS owner_table,
	d_col.attname AS owner_column,
	dep.deptype AS dep_type
FROM
	pg_catalog.pg_sequence s
	JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid
	JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
	LEFT JOIN pg_catalog.pg_depend dep ON dep.objid = c.oid AND dep.deptype IN ('a', 'i') AND dep.classid = 'pg_class'::regclass
	LEFT JOIN pg_catalog.pg_class d_table ON d_table.oid = dep.refobjid AND dep.refclassid = 'pg_class'::regclass
	LEFT JOIN pg_catalog.pg_attribute d_col ON d_col.attrelid = dep.refobjid AND d_col.attnum = dep.refobjsubid
WHERE
	n.nspname IN (%s)
ORDER BY
	n.nspname, c.relname
`

/** Query to find dependencies between objects using pg_depend. */
export const depsQuery = `
SELECT DISTINCT
	src_ns.nspname  AS src_schema,
	COALESCE(src_proc.proname, src_rel.relname) AS src_name,
	CASE
		WHEN src_proc.oid IS NOT NULL AND src_proc.prokind = 'p' THEN 'procedure'
		WHEN src_proc.oid IS NOT NULL THEN 'function'
		WHEN src_rel.relkind = 'r' THEN 'table'
		WHEN src_rel.relkind = 'v' THEN 'view'
		WHEN src_rel.relkind = 'm' THEN 'matview'
		ELSE 'unknown'
	END AS src_kind,
	dep_ns.nspname  AS dep_schema,
	COALESCE(dep_proc.proname, dep_rel.relname, dep_typ.typname) AS dep_name,
	CASE
		WHEN dep_proc.oid IS NOT NULL AND dep_proc.prokind = 'p' THEN 'procedure'
		WHEN dep_proc.oid IS NOT NULL THEN 'function'
		WHEN dep_rel.relkind = 'r' THEN 'table'
		WHEN dep_rel.relkind = 'v' THEN 'view'
		WHEN dep_rel.relkind = 'm' THEN 'matview'
		WHEN dep_typ.typtype = 'e' THEN 'enum'
		WHEN dep_typ.typtype = 'd' THEN 'domain'
		WHEN dep_typ.typtype = 'c' THEN 'composite'
		ELSE 'unknown'
	END AS dep_kind
FROM pg_catalog.pg_depend d
-- Source: function/procedure
LEFT JOIN pg_catalog.pg_proc src_proc ON d.classid = 'pg_proc'::regclass AND src_proc.oid = d.objid
LEFT JOIN pg_catalog.pg_namespace src_proc_ns ON src_proc.pronamespace = src_proc_ns.oid
-- Source: table/view
LEFT JOIN pg_catalog.pg_class src_rel ON d.classid = 'pg_class'::regclass AND src_rel.oid = d.objid AND src_rel.relkind IN ('r', 'v', 'm')
LEFT JOIN pg_catalog.pg_namespace src_rel_ns ON src_rel.relnamespace = src_rel_ns.oid
-- Combined source namespace
CROSS JOIN LATERAL (SELECT COALESCE(src_proc_ns.nspname, src_rel_ns.nspname) AS nspname) src_ns
-- Dependency target: table/view
LEFT JOIN pg_catalog.pg_class dep_rel ON d.refclassid = 'pg_class'::regclass AND dep_rel.oid = d.refobjid AND dep_rel.relkind IN ('r', 'v', 'm')
LEFT JOIN pg_catalog.pg_namespace dep_rel_ns ON dep_rel.relnamespace = dep_rel_ns.oid
-- Dependency target: function/procedure
LEFT JOIN pg_catalog.pg_proc dep_proc ON d.refclassid = 'pg_proc'::regclass AND dep_proc.oid = d.refobjid
LEFT JOIN pg_catalog.pg_namespace dep_proc_ns ON dep_proc.pronamespace = dep_proc_ns.oid
-- Dependency target: type (enum, domain, composite)
LEFT JOIN pg_catalog.pg_type dep_typ ON d.refclassid = 'pg_type'::regclass AND dep_typ.oid = d.refobjid AND dep_typ.typtype IN ('e', 'd', 'c')
LEFT JOIN pg_catalog.pg_namespace dep_typ_ns ON dep_typ.typnamespace = dep_typ_ns.oid
-- Combined dep namespace
CROSS JOIN LATERAL (SELECT COALESCE(dep_rel_ns.nspname, dep_proc_ns.nspname, dep_typ_ns.nspname) AS nspname) dep_ns
WHERE
	d.deptype IN ('n', 'a')
	AND (src_proc.oid IS NOT NULL OR src_rel.oid IS NOT NULL)
	AND (dep_rel.oid IS NOT NULL OR dep_proc.oid IS NOT NULL OR dep_typ.oid IS NOT NULL)
	-- Exclude self-references
	AND NOT (d.classid = d.refclassid AND d.objid = d.refobjid)
	-- Only user schemas
	AND src_ns.nspname NOT IN ('pg_catalog', 'information_schema')
	AND dep_ns.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY src_ns.nspname, src_name, dep_ns.nspname, dep_name
`

/** Query to list extensions. */
export const extensionsQuery = `
SELECT
	e.extname AS name,
	n.nspname AS schema_name,
	e.extversion AS version
FROM
	pg_catalog.pg_extension e
	JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
WHERE
	e.extname != 'plpgsql'
ORDER BY
	e.extname
`

/** Query to list row-level security policies. */
export const policiesQuery = `
SELECT
	p.schemaname,
	p.tablename,
	p.policyname,
	LOWER(p.permissive) AS permissive,
	LOWER(p.cmd) AS cmd,
	ARRAY_TO_STRING(p.roles, ',') AS roles,
	COALESCE(p.qual, '') AS using_expr,
	COALESCE(p.with_check, '') AS check_expr
FROM
	pg_catalog.pg_policies p
WHERE
	p.schemaname IN (%s)
ORDER BY
	p.schemaname, p.tablename, p.policyname
`

/** Query to list event triggers. */
export const eventTriggersQuery = `
SELECT
	e.evtname,
	e.evtevent,
	p.proname AS func_name,
	COALESCE(ARRAY_TO_STRING(e.evttags, ','), '') AS tags
FROM
	pg_catalog.pg_event_trigger e
	JOIN pg_catalog.pg_proc p ON p.oid = e.evtfoid
ORDER BY
	e.evtname
`

/** Query to list range types defined in the schemas. */
export const rangeTypesQuery = `
SELECT
	n.nspname AS schema_name,
	t.typname AS type_name,
	format_type(r.rngsubtype, NULL) AS subtype,
	COALESCE(p.proname, '') AS subtype_diff,
	COALESCE(mt.typname, '') AS multirange_name
FROM pg_catalog.pg_range r
JOIN pg_catalog.pg_type t ON t.oid = r.rngtypid
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_proc p ON p.oid = r.rngsubdiff
LEFT JOIN pg_catalog.pg_type mt ON mt.oid = r.rngmultitypid
WHERE n.nspname IN (%s)
ORDER BY n.nspname, t.typname
`

// -- Parameter Placeholder Helpers --

/** Generate $1, $2, ..., $n parameter placeholders for PostgreSQL. */
export function nArgs(offset: number, count: number): string {
  const parts: string[] = []
  for (let i = 1; i <= count; i++) {
    parts.push(`$${offset + i}`)
  }
  return parts.join(', ')
}

// -- Version Detection --

/** Parse server version from SHOW server_version_num output (e.g., "150000" for PG 15). */
export function parseVersion(versionStr: string): number {
  const n = parseInt(versionStr, 10)
  if (isNaN(n)) {
    throw new Error(`postgres: malformed version: ${versionStr}`)
  }
  return n
}

/** Reports if the server supports the INCLUDE clause (PG >= 11). */
export function supportsIndexInclude(version: number): boolean {
  return version >= 110000
}

/** Reports if the server supports the NULLS [NOT] DISTINCT clause (PG >= 15). */
export function supportsIndexNullsDistinct(version: number): boolean {
  return version >= 150000
}

/** Return the appropriate indexes query for the given server version. */
export function indexesQuery(version: number): string {
  if (supportsIndexNullsDistinct(version)) return indexesAbove15
  if (supportsIndexInclude(version)) return indexesAbove11
  return indexesBelow11
}

// -- Type Category --

/** Type categories for PostgreSQL types. */
export type TypeCategory =
  | 'integer'
  | 'float'
  | 'decimal'
  | 'boolean'
  | 'string'
  | 'time'
  | 'binary'
  | 'json'
  | 'uuid'
  | 'spatial'
  | 'enum'
  | 'array'
  | 'composite'
  | 'domain'
  | 'range'
  | 'serial'
  | 'network'
  | 'currency'
  | 'text_search'
  | 'interval'
  | 'xml'
  | 'bit'
  | 'oid'
  | 'pseudo'
  | 'unsupported'

/** Determine the TypeCategory for a given PostgreSQL type. */
export function typeCategory(typeName: string): TypeCategory {
  const t = typeName.toLowerCase().trim()

  // Integer types
  if (
    [
      TypeBigInt,
      TypeInt8,
      TypeInt,
      TypeInteger,
      TypeInt4,
      TypeSmallInt,
      TypeInt2,
      TypeInt64,
      TypeXID,
      TypeXID8,
    ].includes(t)
  )
    return 'integer'

  // Boolean
  if (t === TypeBool || t === TypeBoolean) return 'boolean'

  // Float types
  if ([TypeReal, TypeDouble, TypeFloat, TypeFloat4, TypeFloat8].includes(t)) return 'float'

  // Decimal types
  if (t === TypeDecimal || t === TypeNumeric) return 'decimal'

  // Serial types
  if ([TypeSmallSerial, TypeSerial, TypeBigSerial, TypeSerial2, TypeSerial4, TypeSerial8].includes(t)) return 'serial'

  // String types
  if ([TypeCharacter, TypeChar, TypeCharVar, TypeVarChar, TypeText, TypeBPChar, TypeName].includes(t)) return 'string'

  // Bit types
  if (t === TypeBit || t === TypeBitVar) return 'bit'

  // Time types
  if (
    [
      TypeDate,
      TypeTime,
      TypeTimeTZ,
      TypeTimeWTZ,
      TypeTimeWOTZ,
      TypeTimestamp,
      TypeTimestampTZ,
      TypeTimestampWTZ,
      TypeTimestampWOTZ,
    ].includes(t)
  )
    return 'time'

  // Interval
  if (t === TypeInterval) return 'interval'

  // Binary
  if (t === TypeBytea) return 'binary'

  // JSON
  if (t === TypeJSON || t === TypeJSONB) return 'json'

  // UUID
  if (t === TypeUUID) return 'uuid'

  // XML
  if (t === TypeXML) return 'xml'

  // Currency
  if (t === TypeMoney) return 'currency'

  // Network types
  if ([TypeCIDR, TypeInet, TypeMACAddr, TypeMACAddr8].includes(t)) return 'network'

  // Spatial types
  if ([TypeCircle, TypeLine, TypeLseg, TypeBox, TypePath, TypePolygon, TypePoint, TypeGeometry].includes(t))
    return 'spatial'

  // Text search
  if (t === TypeTSVector || t === TypeTSQuery) return 'text_search'

  // Range types
  if (
    [
      TypeInt4Range,
      TypeInt4MultiRange,
      TypeInt8Range,
      TypeInt8MultiRange,
      TypeNumRange,
      TypeNumMultiRange,
      TypeTSRange,
      TypeTSMultiRange,
      TypeTSTZRange,
      TypeTSTZMultiRange,
      TypeDateRange,
      TypeDateMultiRange,
    ].includes(t)
  )
    return 'range'

  // Array
  if (t === TypeArray || t.endsWith('[]') || t.startsWith('_')) return 'array'

  // OID types
  if (
    [
      TypeOID,
      TypeRegClass,
      TypeRegCollation,
      TypeRegConfig,
      TypeRegDictionary,
      TypeRegNamespace,
      TypeRegOper,
      TypeRegOperator,
      TypeRegProc,
      TypeRegProcedure,
      TypeRegRole,
      TypeRegType,
    ].includes(t)
  )
    return 'oid'

  // Pseudo-types
  if (
    [
      TypeAny,
      TypeAnyElement,
      TypeAnyArray,
      TypeAnyNonArray,
      TypeAnyEnum,
      TypeInternal,
      TypeRecord,
      TypeTrigger,
      TypeEventTrigger,
      TypeVoid,
      TypeUnknown,
    ].includes(t)
  )
    return 'pseudo'

  return 'unsupported'
}

// -- Array Type Helpers --

/** Regex to parse array declaration. See: https://postgresql.org/docs/current/arrays.html */
const reArray = /(?:(.+?)(( +ARRAY( *\[[ \d]*] *)*)+|( *\[[ \d]*] *)+))$/i

/** Check if a type name represents an array type. */
export function isArrayType(typeName: string): boolean {
  return reArray.test(typeName)
}

/** Parse array type to get element type: "integer[]" -> "integer", "_int4" -> "int4" */
export function arrayElementType(typeName: string): string {
  const t = typeName.trim()
  // Internal array notation: _int4, _text, etc.
  if (t.startsWith('_')) return t.slice(1)
  // Standard notation: integer[], text[2], etc.
  const matches = reArray.exec(t)
  if (matches && matches[1]) return matches[1].trim()
  return t
}

/** Check if a type name represents a serial type. */
export function isSerial(typeName: string): boolean {
  const t = typeName.toLowerCase()
  return [TypeSmallSerial, TypeSerial, TypeBigSerial, TypeSerial2, TypeSerial4, TypeSerial8].includes(t)
}

// -- Interval Fields --

/** Regex to parse interval field declarations. */
const reInterval =
  /(?:INTERVAL\s*)?(YEAR|MONTH|DAY|HOUR|MINUTE|SECOND|YEAR TO MONTH|DAY TO HOUR|DAY TO MINUTE|DAY TO SECOND|HOUR TO MINUTE|HOUR TO SECOND|MINUTE TO SECOND)?\s*(?:\(([0-6])\))?$/i

// -- Type Parsing --

/**
 * Parse a PostgreSQL type name into a SchemaType.
 * Handles: integer types, float types, decimal, boolean, string types,
 * time types, binary, json, uuid, spatial, array types, composite types,
 * domain types, range types, serial types, network types, currency, text search,
 * interval, bit, xml, oid, and pseudo-types.
 */
export function parseType(typeName: string): SchemaType {
  const orig = typeName.trim()
  if (orig === '') {
    return { kind: 'unsupported', T: orig }
  }

  // Check for array types first (e.g., "integer[]", "text ARRAY")
  if (isArrayType(orig)) {
    const elemType = arrayElementType(orig)
    const inner = parseType(elemType)
    return { kind: 'array', T: orig, type: inner } as ArrayType
  }

  // Parse into column descriptor for detailed handling
  const desc = parseColumnDesc(orig)
  const result = columnType(desc)
  // Remove zero-value fields to match Go omitempty behavior
  for (const key of ['size', 'precision', 'scale'] as const) {
    if ((result as any)[key] === 0) delete (result as any)[key]
  }
  // Schema-qualified unrecognized types are user-defined → 'unknown' (matches Go UserDefinedType)
  if (result.kind === 'unsupported' && orig.includes('.')) {
    ;(result as any).kind = 'unknown'
  }
  return result
}

/** Internal column descriptor for type parsing. */
interface ColumnDesc {
  typ: string
  fmtype: string
  size: number
  precision: number
  timePrecision: number | null
  scale: number
  interval: string
}

/** Parse a type string into a column descriptor. */
function parseColumnDesc(s: string): ColumnDesc {
  const parts = s.split(/[(),\s]+/).filter(Boolean)
  const desc: ColumnDesc = {
    typ: parts[0],
    fmtype: '',
    size: 0,
    precision: 0,
    timePrecision: null,
    scale: 0,
    interval: '',
  }

  const lower0 = parts[0].toLowerCase()

  switch (lower0) {
    case TypeVarChar:
    case TypeCharVar:
    case TypeChar:
    case TypeCharacter: {
      // Handle "character varying" as a special two-word type
      if (lower0 === TypeCharacter && parts[1]?.toLowerCase() === 'varying') {
        desc.typ = TypeCharVar
        if (parts[2]) desc.size = parseInt(parts[2], 10) || 0
      } else {
        const sizeIdx = lower0 === TypeCharVar ? 2 : 1
        if (parts[sizeIdx]) desc.size = parseInt(parts[sizeIdx], 10) || 0
      }
      break
    }
    case TypeDecimal:
    case TypeNumeric:
    case TypeFloat:
      if (parts[1]) desc.precision = parseInt(parts[1], 10) || 0
      if (parts[2]) desc.scale = parseInt(parts[2], 10) || 0
      break
    case TypeBit:
      if (parts[1]?.toLowerCase() === 'varying') {
        desc.typ = TypeBitVar
        if (parts[2]) desc.size = parseInt(parts[2], 10) || 0
      } else {
        desc.size = parts[1] ? parseInt(parts[1], 10) || 1 : 1
      }
      break
    case TypeDouble:
      if (parts[1]?.toLowerCase() === 'precision') {
        desc.typ = TypeDouble
      }
      desc.precision = 53
      break
    case TypeFloat8:
      desc.precision = 53
      break
    case TypeReal:
    case TypeFloat4:
      desc.precision = 24
      break
    case TypeTime:
    case TypeTimeTZ:
    case TypeTimestamp:
    case TypeTimestampTZ: {
      let p = defaultTimePrecision
      const rest = parts.slice(1)
      // Check if next part is a precision digit
      if (rest.length > 0 && /^\d$/.test(rest[0])) {
        p = parseInt(rest[0], 10)
        rest.shift()
      }
      desc.timePrecision = p
      // Normalize "with time zone" / "without time zone" variants
      const joined = (lower0 + ' ' + rest.join(' ')).toLowerCase().trim()
      desc.typ = timeAlias(joined)
      break
    }
    case TypeInterval: {
      const matches = reInterval.exec(s)
      if (matches) {
        desc.interval = matches[1] || ''
        if (matches[2]) {
          desc.timePrecision = parseInt(matches[2], 10)
        } else {
          desc.timePrecision = defaultTimePrecision
        }
      } else {
        desc.timePrecision = defaultTimePrecision
      }
      break
    }
    default:
      // For multi-word types like "double precision", "character varying", etc.
      desc.typ = s
      break
  }

  return desc
}

/** Normalize time type aliases — keep full canonical name (matches Go). */
function timeAlias(t: string): string {
  return t.toLowerCase()
}

/** Convert a column descriptor to a SchemaType. */
function columnType(c: ColumnDesc): SchemaType {
  const t = c.typ
  const lower = t.toLowerCase()

  // Integer types
  if (
    [
      TypeBigInt,
      TypeInt8,
      TypeInt,
      TypeInteger,
      TypeInt4,
      TypeSmallInt,
      TypeInt2,
      TypeInt64,
      TypeXID,
      TypeXID8,
    ].includes(lower)
  )
    return { kind: 'integer', T: t } as IntegerType

  // Bit types: map to binary
  if (lower === TypeBit || lower === TypeBitVar) return { kind: 'binary', T: t, size: c.size } as BinaryType

  // Boolean
  if (lower === TypeBool || lower === TypeBoolean) return { kind: 'boolean', T: t } as BoolType

  // Bytea
  if (lower === TypeBytea) return { kind: 'binary', T: t } as BinaryType

  // String types
  if ([TypeCharacter, TypeChar, TypeCharVar, TypeVarChar, TypeText, TypeBPChar, TypeName].includes(lower))
    return { kind: 'string', T: t, size: c.size } as StringType

  // Network types
  if ([TypeCIDR, TypeInet, TypeMACAddr, TypeMACAddr8].includes(lower)) return { kind: 'network', T: t } as NetworkType

  // Spatial types
  if ([TypeCircle, TypeLine, TypeLseg, TypeBox, TypePath, TypePolygon, TypePoint, TypeGeometry].includes(lower))
    return { kind: 'spatial', T: t } as SpatialType

  // Date (no precision)
  if (lower === TypeDate) return { kind: 'time', T: t } as TimeType

  // Time types with precision
  if (
    [
      TypeTime,
      TypeTimeWOTZ,
      TypeTimeTZ,
      TypeTimeWTZ,
      TypeTimestamp,
      TypeTimestampTZ,
      TypeTimestampWTZ,
      TypeTimestampWOTZ,
    ].includes(lower)
  ) {
    const precision = c.timePrecision ?? defaultTimePrecision
    return { kind: 'time', T: t, precision } as TimeType
  }

  // Interval
  if (lower === TypeInterval) {
    const precision = c.timePrecision ?? defaultTimePrecision
    const result: IntervalType = { kind: 'interval', T: t, precision }
    if (c.interval) result.fields = c.interval
    return result
  }

  // Float types
  if ([TypeReal, TypeDouble, TypeFloat, TypeFloat4, TypeFloat8].includes(lower))
    return { kind: 'float', T: t, precision: c.precision } as FloatType

  // JSON types
  if (lower === TypeJSON || lower === TypeJSONB) return { kind: 'json', T: t } as JSONType

  // Currency
  if (lower === TypeMoney) return { kind: 'currency', T: t } as CurrencyType

  // Decimal types
  if (lower === TypeDecimal || lower === TypeNumeric)
    return { kind: 'decimal', T: t, precision: c.precision, scale: c.scale } as DecimalType

  // Serial types
  if ([TypeSmallSerial, TypeSerial, TypeBigSerial, TypeSerial2, TypeSerial4, TypeSerial8].includes(lower))
    return { kind: 'serial', T: t } as SerialType

  // UUID
  if (lower === TypeUUID) return { kind: 'uuid', T: t } as UUIDType

  // XML (stored as unsupported since we don't have an XMLType in schema.ts)
  if (lower === TypeXML) return { kind: 'unsupported', T: t } as UnsupportedType

  // Array type keyword
  if (lower === TypeArray) {
    const inner: UnsupportedType = { kind: 'unsupported', T: c.fmtype || t }
    return { kind: 'array', T: c.fmtype || t, type: inner } as ArrayType
  }

  // Text search types
  if (lower === TypeTSVector || lower === TypeTSQuery) return { kind: 'text_search', T: t } as TextSearchType

  // Range types
  if (
    [
      TypeInt4Range,
      TypeInt4MultiRange,
      TypeInt8Range,
      TypeInt8MultiRange,
      TypeNumRange,
      TypeNumMultiRange,
      TypeTSRange,
      TypeTSMultiRange,
      TypeTSTZRange,
      TypeTSTZMultiRange,
      TypeDateRange,
      TypeDateMultiRange,
    ].includes(lower)
  )
    return { kind: 'range', T: t } as RangeType

  // OID types - treat as integer
  if (
    [
      TypeOID,
      TypeRegClass,
      TypeRegCollation,
      TypeRegConfig,
      TypeRegDictionary,
      TypeRegNamespace,
      TypeRegOper,
      TypeRegOperator,
      TypeRegProc,
      TypeRegProcedure,
      TypeRegRole,
      TypeRegType,
    ].includes(lower)
  )
    return { kind: 'integer', T: t } as IntegerType

  // Pseudo-types - treat as unsupported
  if (
    [
      TypeAny,
      TypeAnyElement,
      TypeAnyArray,
      TypeAnyNonArray,
      TypeAnyEnum,
      TypeInternal,
      TypeRecord,
      TypeTrigger,
      TypeEventTrigger,
      TypeVoid,
      TypeUnknown,
    ].includes(lower)
  )
    return { kind: 'unsupported', T: t } as UnsupportedType

  // Fallback: user-defined type (returned as unsupported since our schema model
  // uses unsupported as the catch-all for unknown types)
  return { kind: 'unsupported', T: t } as UnsupportedType
}

// -- Function Argument Parsing --

/**
 * Parse a function argument string from pg_get_function_arguments into structured args.
 * Format: "arg1 type1, arg2 type2" or "IN arg1 type1, OUT arg2 type2".
 */
export function parseFuncArgs(
  argsStr: string,
): Array<{ name?: string; type: SchemaType; mode?: string; default?: string }> {
  if (!argsStr || argsStr.trim() === '') return []

  const result: Array<{ name?: string; type: SchemaType; mode?: string; default?: string }> = []

  for (let part of argsStr.split(',')) {
    part = part.trim()
    if (!part) continue

    const arg: { name?: string; type: SchemaType; mode?: string; default?: string } = {
      type: { kind: 'unsupported', T: '' },
    }

    // Check for mode prefix
    const upper = part.toUpperCase()
    if (upper.startsWith('INOUT ')) {
      arg.mode = 'INOUT'
      part = part.slice(6).trim()
    } else if (upper.startsWith('IN ')) {
      arg.mode = 'IN'
      part = part.slice(3).trim()
    } else if (upper.startsWith('OUT ')) {
      arg.mode = 'OUT'
      part = part.slice(4).trim()
    } else if (upper.startsWith('VARIADIC ')) {
      arg.mode = 'VARIADIC'
      part = part.slice(9).trim()
    }

    // Strip DEFAULT clauses
    const defIdx = part.toUpperCase().indexOf(' DEFAULT ')
    if (defIdx !== -1) {
      arg.default = part.slice(defIdx + 9).trim()
      part = part.slice(0, defIdx).trim()
    }

    // Split into name and type. The last word(s) are the type.
    const tokens = part.split(/\s+/)
    if (tokens.length === 1) {
      // Unnamed arg, just type
      arg.type = parseType(tokens[0])
    } else {
      // Try to parse everything after the first token as a type
      const typStr = tokens.slice(1).join(' ')
      const parsed = parseType(typStr)
      if (parsed.kind !== 'unsupported') {
        arg.name = tokens[0].replace(/"/g, '')
        arg.type = parsed
      } else {
        // Entire string is a type (e.g., "double precision")
        arg.type = parseType(part)
      }
    }

    result.push(arg)
  }

  return result
}

// -- Helper: Strip own schema from type strings --

/**
 * Removes the function's own schema prefix from type strings.
 * e.g. "SETOF public.posts" -> "SETOF posts" when ownSchema is "public".
 */
export function stripOwnSchemaFromType(t: string, ownSchema: string): string {
  const prefix = ownSchema + '.'
  const lower = t.toLowerCase()
  const lowerPrefix = prefix.toLowerCase()

  if (lower.startsWith('setof ')) {
    const rest = t.slice(6)
    if (rest.toLowerCase().startsWith(lowerPrefix)) {
      return t.slice(0, 6) + rest.slice(prefix.length)
    }
    return t
  }
  if (lower.startsWith(lowerPrefix)) {
    return t.slice(prefix.length)
  }
  return t
}

// -- Helper: Extract function body from pg_get_functiondef DDL --

/**
 * Extract just the function body from a pg_get_functiondef DDL string.
 * Looks for dollar-quoted strings ($tag$...$tag$).
 */
export function extractFuncBody(def: string): string {
  const idx = def.indexOf('$')
  if (idx === -1) return ''
  const endTag = def.indexOf('$', idx + 1)
  if (endTag === -1) return ''
  const tag = def.slice(idx, endTag + 1)
  const bodyStart = idx + tag.length
  const bodyEnd = def.lastIndexOf(tag)
  if (bodyEnd <= bodyStart) return ''
  return def.slice(bodyStart, bodyEnd).trim()
}

// -- Reference Action Parsing --

/** Parse a PostgreSQL reference action code to its string representation. */
export function parseReferenceAction(code: string): string | undefined {
  switch (code.toLowerCase()) {
    case 'a':
      return 'NO ACTION'
    case 'r':
      return 'RESTRICT'
    case 'c':
      return 'CASCADE'
    case 'n':
      return 'SET NULL'
    case 'd':
      return 'SET DEFAULT'
    default:
      return undefined
  }
}

/** Query to list aggregate functions. */
export const aggregatesQuery = `
SELECT
  n.nspname AS schema_name,
  p.proname AS agg_name,
  sf.proname AS state_func,
  pg_catalog.format_type(a.aggtranstype, NULL) AS state_type,
  ff.proname AS final_func,
  a.agginitval AS init_val,
  COALESCE(so.oprname, '') AS sort_op,
  CASE p.proparallel
    WHEN 's' THEN 'SAFE'
    WHEN 'u' THEN 'UNSAFE'
    WHEN 'r' THEN 'RESTRICTED'
    ELSE ''
  END AS parallel,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS arg_types
FROM
  pg_catalog.pg_aggregate a
  JOIN pg_catalog.pg_proc p ON p.oid = a.aggfnoid
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_proc sf ON sf.oid = a.aggtransfn
  LEFT JOIN pg_catalog.pg_proc ff ON ff.oid = a.aggfinalfn
  LEFT JOIN pg_catalog.pg_operator so ON so.oid = a.aggsortop
WHERE
  n.nspname IN (%s)
ORDER BY
  n.nspname, p.proname
`
