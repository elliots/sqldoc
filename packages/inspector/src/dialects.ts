import { type Dialect, quoteIdentifier } from '@sqldoc/core'
import type { DatabaseAdapter } from './adapter.ts'
import type { PlanDriver } from './internal/plan.ts'
import type { DiffDriver } from './internal/sqlx.ts'
import type { Stmt } from './migrate/lex.ts'
import { AzureSqlInspector } from './mssql/azuresql.ts'
import { MssqlDiff } from './mssql/diff.ts'
import { mssqlScanStmts } from './mssql/driver.ts'
import { MssqlInspector } from './mssql/inspect.ts'
import { MssqlPlan } from './mssql/migrate.ts'
import { MysqlDiff } from './mysql/diff.ts'
import { mysqlScanStmts } from './mysql/driver.ts'
import { MysqlInspector } from './mysql/inspect.ts'
import { MysqlPlan } from './mysql/migrate.ts'
import { TidbDiff, TidbInspect, TidbPlan } from './mysql/tidb.ts'
import { CrdbDiff, CrdbInspector } from './postgres/crdb.ts'
import { PostgresDiff } from './postgres/diff.ts'
import { postgresScanStmts } from './postgres/driver.ts'
import { PostgresInspector } from './postgres/inspect.ts'
import { PostgresPlan, withCascade } from './postgres/migrate.ts'
import type { ExecQuerier, Inspector } from './schema/inspect.ts'
import type { Change } from './schema/migrate.ts'
import type { Realm } from './schema/schema.ts'
import { SqliteDiff } from './sqlite/diff.ts'
import { sqliteScanStmts } from './sqlite/driver.ts'
import { SqliteInspector } from './sqlite/inspect.ts'
import { SqlitePlan } from './sqlite/migrate.ts'

export type { Dialect } from '@sqldoc/core'

export interface DialectVariantOptions {
  crdb?: boolean
  tidb?: boolean
  azuresql?: boolean
}

export interface InspectorDialectComponents {
  inspector: Inspector
  differ: DiffDriver
  planner: PlanDriver
}

export type InspectorDialectVariant = 'postgres' | 'crdb' | 'mysql' | 'tidb' | 'sqlite' | 'mssql' | 'azuresql'
export type ChangeTransform = (changes: Change[]) => Change[]

interface DialectRuntimeSpec {
  statementBatchSize: number
  scanStatements: (input: string) => Stmt[]
  isSystemSchema: (schemaName: string) => boolean
}

interface InspectorDialectVariantSpec {
  dialect: Dialect
  createComponents: (db: DatabaseAdapter, eq: ExecQuerier) => InspectorDialectComponents
  restoreTransform?: ChangeTransform
}

function schemaSetMatcher(
  schemas: string[],
  extraMatch?: (schemaName: string) => boolean,
): (schemaName: string) => boolean {
  const schemaSet = new Set(schemas)
  return (schemaName) => schemaSet.has(schemaName) || extraMatch?.(schemaName) === true
}

const DIALECT_RUNTIME_SPECS: Record<Dialect, DialectRuntimeSpec> = {
  postgres: {
    statementBatchSize: 50,
    scanStatements: postgresScanStmts,
    isSystemSchema: schemaSetMatcher(['information_schema', 'pg_catalog', 'pg_toast'], (schemaName) =>
      schemaName.startsWith('pg_temp_'),
    ),
  },
  mysql: {
    statementBatchSize: 50,
    scanStatements: mysqlScanStmts,
    isSystemSchema: schemaSetMatcher(['information_schema', 'mysql', 'performance_schema', 'sys']),
  },
  sqlite: {
    statementBatchSize: 50,
    scanStatements: sqliteScanStmts,
    isSystemSchema: () => false,
  },
  mssql: {
    statementBatchSize: 1,
    scanStatements: mssqlScanStmts,
    isSystemSchema: schemaSetMatcher(['INFORMATION_SCHEMA', 'sys', 'guest']),
  },
}

const DIALECT_VARIANT_SPECS: Record<InspectorDialectVariant, InspectorDialectVariantSpec> = {
  postgres: {
    dialect: 'postgres',
    createComponents: (db) => ({
      inspector: new PostgresInspector(db),
      differ: new PostgresDiff(),
      planner: new PostgresPlan(),
    }),
    restoreTransform: withCascade,
  },
  crdb: {
    dialect: 'postgres',
    createComponents: (db) => ({
      inspector: new CrdbInspector(db),
      differ: new CrdbDiff(),
      planner: new PostgresPlan(),
    }),
    restoreTransform: withCascade,
  },
  mysql: {
    dialect: 'mysql',
    createComponents: (_db, eq) => ({
      inspector: new MysqlInspector(eq),
      differ: new MysqlDiff(),
      planner: new MysqlPlan(),
    }),
  },
  tidb: {
    dialect: 'mysql',
    createComponents: (_db, eq) => ({
      inspector: new TidbInspect(eq),
      differ: new TidbDiff(),
      planner: new TidbPlan(),
    }),
  },
  sqlite: {
    dialect: 'sqlite',
    createComponents: (_db, eq) => ({
      inspector: new SqliteInspector(eq),
      differ: new SqliteDiff(),
      planner: new SqlitePlan(),
    }),
  },
  mssql: {
    dialect: 'mssql',
    createComponents: (_db, eq) => ({
      inspector: new MssqlInspector(eq),
      differ: new MssqlDiff(),
      planner: new MssqlPlan(),
    }),
  },
  azuresql: {
    dialect: 'mssql',
    createComponents: (_db, eq) => ({
      inspector: new AzureSqlInspector(eq),
      differ: new MssqlDiff(),
      planner: new MssqlPlan(),
    }),
  },
}

function assertCompatibleVariant(dialect: Dialect, options: DialectVariantOptions): void {
  if (options.crdb && dialect !== 'postgres') {
    throw new Error(`crdb mode is only valid for postgres dialect, got "${dialect}"`)
  }
  if (options.tidb && dialect !== 'mysql') {
    throw new Error(`tidb mode is only valid for mysql dialect, got "${dialect}"`)
  }
  if (options.azuresql && dialect !== 'mssql') {
    throw new Error(`azuresql mode is only valid for mssql dialect, got "${dialect}"`)
  }
}

export function resolveInspectorDialectVariant(
  dialect: Dialect,
  options: DialectVariantOptions = {},
): InspectorDialectVariant {
  assertCompatibleVariant(dialect, options)
  if (options.crdb) return 'crdb'
  if (options.tidb) return 'tidb'
  if (options.azuresql) return 'azuresql'
  return dialect
}

export function getDialectRuntimeSpec(dialect: Dialect): DialectRuntimeSpec {
  return DIALECT_RUNTIME_SPECS[dialect]
}

export function getInspectorDialectVariantSpec(
  dialect: Dialect,
  options: DialectVariantOptions = {},
): InspectorDialectVariantSpec {
  return DIALECT_VARIANT_SPECS[resolveInspectorDialectVariant(dialect, options)]
}

export function filterSystemSchemas(realm: Realm, dialect: Dialect): Realm {
  const runtime = getDialectRuntimeSpec(dialect)
  const filteredSchemas = realm.schemas.filter((schema) => !runtime.isSystemSchema(schema.name))
  if (filteredSchemas.length === realm.schemas.length) return realm
  return { ...realm, schemas: filteredSchemas }
}

export function scanDialectStatements(input: string, dialect?: Dialect): Stmt[] {
  return getDialectRuntimeSpec(dialect ?? 'postgres').scanStatements(input)
}

export function getDialectStatementBatchSize(dialect?: Dialect): number {
  return getDialectRuntimeSpec(dialect ?? 'postgres').statementBatchSize
}

export function stripDefaultSchemaQualifier(statements: string[], dialect: Dialect, defaultSchema?: string): string[] {
  if (!defaultSchema) return statements
  const prefix = `${quoteIdentifier(defaultSchema, dialect)}.`
  return statements.map((statement) => statement.split(prefix).join(''))
}
