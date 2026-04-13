import type { Dialect } from './sql-emitter.ts'

export interface DialectSpec {
  defaultDevUrl: string
  defaultSchema?: string
}

const DIALECT_SPECS = {
  postgres: {
    defaultDevUrl: 'pglite',
    defaultSchema: 'public',
  },
  mysql: {
    defaultDevUrl: 'docker://mysql:8',
  },
  sqlite: {
    defaultDevUrl: ':memory:',
    defaultSchema: 'main',
  },
  mssql: {
    defaultDevUrl: 'docker://mcr.microsoft.com/mssql/server:2022-latest',
    defaultSchema: 'dbo',
  },
} satisfies Record<Dialect, DialectSpec>

export function getDialectSpec(dialect: Dialect): DialectSpec {
  return DIALECT_SPECS[dialect]
}

export function defaultDevUrlForDialect(dialect: Dialect): string {
  return getDialectSpec(dialect).defaultDevUrl
}

export function defaultSchemaForDialect(dialect: Dialect): string | undefined {
  return getDialectSpec(dialect).defaultSchema
}
