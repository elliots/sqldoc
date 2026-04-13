import { after, describe, expect, it } from '@sqldoc/test-utils'
import type { DatabaseAdapter } from '../db/types.ts'
import { createAdapter, defaultDevUrlForDialect, defaultSchemaForDialect, getDialectSpec } from '../index.ts'

describe('dialect metadata', () => {
  it('returns centralized defaults for every dialect', () => {
    expect(getDialectSpec('postgres')).toEqual({
      defaultDevUrl: 'pglite',
      defaultSchema: 'public',
    })
    expect(getDialectSpec('mysql')).toEqual({
      defaultDevUrl: 'docker://mysql:8',
    })
    expect(getDialectSpec('sqlite')).toEqual({
      defaultDevUrl: ':memory:',
      defaultSchema: 'main',
    })
    expect(getDialectSpec('mssql')).toEqual({
      defaultDevUrl: 'docker://mcr.microsoft.com/mssql/server:2022-latest',
      defaultSchema: 'dbo',
    })
  })

  it('exposes default schema helpers consistently', () => {
    expect(defaultSchemaForDialect('postgres')).toBe('public')
    expect(defaultSchemaForDialect('mysql')).toBeUndefined()
    expect(defaultSchemaForDialect('sqlite')).toBe('main')
    expect(defaultSchemaForDialect('mssql')).toBe('dbo')
  })

  it('exposes default dev url helpers consistently', () => {
    expect(defaultDevUrlForDialect('postgres')).toBe('pglite')
    expect(defaultDevUrlForDialect('mysql')).toBe('docker://mysql:8')
    expect(defaultDevUrlForDialect('sqlite')).toBe(':memory:')
    expect(defaultDevUrlForDialect('mssql')).toBe('docker://mcr.microsoft.com/mssql/server:2022-latest')
  })
})

describe('createAdapter defaults', () => {
  let adapter: DatabaseAdapter | undefined

  after(async () => {
    if (adapter) await adapter.close()
  })

  it('uses the centralized sqlite default dev url', async () => {
    adapter = await createAdapter({ dialect: 'sqlite' })
    expect(adapter.currentSchema).toBe(defaultSchemaForDialect('sqlite'))
    const result = await adapter.query('SELECT 1 AS num')
    expect(result.rows).toEqual([[1]])
  })
})
