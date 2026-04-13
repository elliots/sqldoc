import { describe, expect, it } from '@sqldoc/test-utils'
import { PostgresAstAdapter } from '../../ast/pgsql-parser.ts'
import { SqlparserTsAdapter } from '../../ast/sqlparser-ts.ts'
import { createAstAdapter } from '../../index.ts'

describe('createAstAdapter', () => {
  it('uses PostgresAstAdapter for postgres', () => {
    const adapter = createAstAdapter('postgres')
    expect(adapter).toBeInstanceOf(PostgresAstAdapter)
  })

  it('falls back to SqlparserTsAdapter for mssql', () => {
    const adapter = createAstAdapter('mssql')
    expect(adapter).toBeInstanceOf(SqlparserTsAdapter)
  })
})
