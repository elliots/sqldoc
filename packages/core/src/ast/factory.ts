import type { Dialect } from '../sql-emitter.ts'
import type { SqlAstAdapter } from './adapter.ts'
import { PostgresAstAdapter } from './pgsql-parser.ts'
import { SqlparserTsAdapter } from './sqlparser-ts.ts'

export type AstAdapterFactory = (dialect: Dialect) => SqlAstAdapter

const fallbackAstAdapterFactory: AstAdapterFactory = (dialect) => new SqlparserTsAdapter(dialect)

const DIALECT_AST_ADAPTER_FACTORIES: Partial<Record<Dialect, AstAdapterFactory>> = {
  postgres: () => new PostgresAstAdapter(),
}

/**
 * Create the SQL AST adapter for a dialect.
 * Falls back to sqlparser-ts until a dialect-specific adapter exists.
 */
export function createAstAdapter(dialect: Dialect): SqlAstAdapter {
  const factory = DIALECT_AST_ADAPTER_FACTORIES[dialect] ?? fallbackAstAdapterFactory
  return factory(dialect)
}
