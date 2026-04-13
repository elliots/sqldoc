import { after, describe, expect, it } from '@sqldoc/test-utils'
import type { AdapterPluginContext, DatabaseAdapter, DatabaseAdapterPlugin } from '../db/types.ts'
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

  it('uses a provided adapterPlugin for non-docker postgres URLs', async () => {
    const calls: Array<{ devUrl: string; context: AdapterPluginContext }> = []
    const fakeAdapter: DatabaseAdapter = {
      currentSchema: 'public',
      query: async () => ({ columns: ['name'], rows: [['pg_trgm']] }),
      exec: async () => ({ rowsAffected: 0 }),
      close: async () => {},
    }
    const plugin: DatabaseAdapterPlugin = {
      apiVersion: 1,
      name: 'custom-postgres',
      schemes: ['custompg'],
      dialects: ['postgres'],
      runtime: 'any',
      createAdapter: async (devUrl, context) => {
        calls.push({ devUrl, context })
        return fakeAdapter
      },
    }

    adapter = await createAdapter({
      dialect: 'postgres',
      devUrl: 'custompg://dev-db',
      extensions: ['pg_trgm'],
      adapterPlugin: plugin,
    })

    expect(adapter).toBe(fakeAdapter)
    expect(calls).toEqual([
      {
        devUrl: 'custompg://dev-db',
        context: { dialect: 'postgres', extensions: ['pg_trgm'] },
      },
    ])
  })

  it('drops extension context for non-postgres plugins', async () => {
    const calls: Array<{ devUrl: string; context: AdapterPluginContext }> = []
    const fakeAdapter: DatabaseAdapter = {
      currentSchema: '',
      query: async () => ({ columns: [], rows: [] }),
      exec: async () => ({ rowsAffected: 0 }),
      close: async () => {},
    }
    const plugin: DatabaseAdapterPlugin = {
      apiVersion: 1,
      name: 'custom-mysql',
      schemes: ['custommysql'],
      dialects: ['mysql'],
      runtime: 'any',
      createAdapter: async (devUrl, context) => {
        calls.push({ devUrl, context })
        return fakeAdapter
      },
    }

    adapter = await createAdapter({
      dialect: 'mysql',
      devUrl: 'custommysql://dev-db',
      extensions: ['pg_trgm'],
      adapterPlugin: plugin,
    })

    expect(calls).toEqual([
      {
        devUrl: 'custommysql://dev-db',
        context: { dialect: 'mysql', extensions: [] },
      },
    ])
  })
})
