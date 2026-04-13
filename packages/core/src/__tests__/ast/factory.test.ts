import { describe, expect, it } from '@sqldoc/test-utils'
import { SqlparserTsAdapter } from '../../ast/sqlparser-ts.ts'
import { createAstAdapter } from '../../index.ts'

describe('createAstAdapter', () => {
  it('falls back to SqlparserTsAdapter for postgres', () => {
    const adapter = createAstAdapter('postgres')
    expect(adapter).toBeInstanceOf(SqlparserTsAdapter)
  })

  it('falls back to SqlparserTsAdapter for mssql', () => {
    const adapter = createAstAdapter('mssql')
    expect(adapter).toBeInstanceOf(SqlparserTsAdapter)
  })
})
