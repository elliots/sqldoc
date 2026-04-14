import type { Dialect } from './sql-emitter.ts'

export type DatabaseEngine = Dialect | 'crdb' | 'tidb' | 'azuresql'

export interface DialectSpec {
  defaultDevUrl: string
  defaultSchema?: string
}

export interface DatabaseEngineSpec extends DialectSpec {
  dialect: Dialect
}

const ENGINE_SPECS = {
  postgres: {
    dialect: 'postgres',
    defaultDevUrl: 'pglite',
    defaultSchema: 'public',
  },
  crdb: {
    dialect: 'postgres',
    defaultDevUrl: 'pglite',
    defaultSchema: 'public',
  },
  mysql: {
    dialect: 'mysql',
    defaultDevUrl: 'docker://mysql:8',
  },
  tidb: {
    dialect: 'mysql',
    defaultDevUrl: 'docker://mysql:8',
  },
  sqlite: {
    dialect: 'sqlite',
    defaultDevUrl: ':memory:',
    defaultSchema: 'main',
  },
  mssql: {
    dialect: 'mssql',
    defaultDevUrl: 'docker://mcr.microsoft.com/mssql/server:2022-latest',
    defaultSchema: 'dbo',
  },
  azuresql: {
    dialect: 'mssql',
    defaultDevUrl: 'docker://mcr.microsoft.com/mssql/server:2022-latest',
    defaultSchema: 'dbo',
  },
} satisfies Record<DatabaseEngine, DatabaseEngineSpec>

const DIALECT_SPECS = {
  postgres: {
    defaultDevUrl: ENGINE_SPECS.postgres.defaultDevUrl,
    defaultSchema: ENGINE_SPECS.postgres.defaultSchema,
  },
  mysql: {
    defaultDevUrl: ENGINE_SPECS.mysql.defaultDevUrl,
  },
  sqlite: {
    defaultDevUrl: ENGINE_SPECS.sqlite.defaultDevUrl,
    defaultSchema: ENGINE_SPECS.sqlite.defaultSchema,
  },
  mssql: {
    defaultDevUrl: ENGINE_SPECS.mssql.defaultDevUrl,
    defaultSchema: ENGINE_SPECS.mssql.defaultSchema,
  },
} satisfies Record<Dialect, DialectSpec>

export function getEngineSpec(engine: DatabaseEngine): DatabaseEngineSpec {
  return ENGINE_SPECS[engine]
}

export function dialectForEngine(engine: DatabaseEngine): Dialect {
  return getEngineSpec(engine).dialect
}

export function defaultDevUrlForEngine(engine: DatabaseEngine): string {
  return getEngineSpec(engine).defaultDevUrl
}

export function defaultSchemaForEngine(engine: DatabaseEngine): string | undefined {
  return getEngineSpec(engine).defaultSchema
}

export function getDialectSpec(dialect: Dialect): DialectSpec {
  return DIALECT_SPECS[dialect]
}

export function defaultDevUrlForDialect(dialect: Dialect): string {
  return getDialectSpec(dialect).defaultDevUrl
}

export function defaultSchemaForDialect(dialect: Dialect): string | undefined {
  return getDialectSpec(dialect).defaultSchema
}
