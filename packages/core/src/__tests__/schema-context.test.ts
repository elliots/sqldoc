import { describe, expect, it } from '@sqldoc/test-utils'
import { getForeignKeys, getPrimaryKeyColumns, getSchemaColumns, getSchemaTables } from '../schema-context.ts'

describe('schema-context helpers', () => {
  it('reads primary key columns from camelCase inspector tables', () => {
    const columns = getPrimaryKeyColumns({
      name: 'users',
      primaryKey: { parts: [{ column: 'id' }] },
    })

    expect(columns).toEqual(['id'])
  })

  it('reads primary key columns from snake_case test fixtures', () => {
    const columns = getPrimaryKeyColumns({
      name: 'users',
      primary_key: { columns: ['id'] },
    })

    expect(columns).toEqual(['id'])
  })

  it('normalizes foreign keys from both camelCase and snake_case tables', () => {
    const camelCaseKeys = getForeignKeys({
      name: 'orders',
      foreignKeys: [{ columns: ['user_id'], refTable: 'users', refColumns: ['id'], symbol: 'orders_user_id_fkey' }],
    })
    const snakeCaseKeys = getForeignKeys({
      name: 'orders',
      foreign_keys: [{ columns: ['user_id'], ref_table: 'users', ref_columns: ['id'], name: 'orders_user_id_fkey' }],
    })

    expect(camelCaseKeys).toEqual([
      { name: 'orders_user_id_fkey', columns: ['user_id'], refColumns: ['id'], refTable: 'users' },
    ])
    expect(snakeCaseKeys).toEqual([
      { name: 'orders_user_id_fkey', columns: ['user_id'], refColumns: ['id'], refTable: 'users' },
    ])
  })

  it('flattens tables from all schemas', () => {
    const tables = getSchemaTables({
      schemas: [
        { name: 'public', tables: [{ name: 'users' }] },
        { name: 'tenant', tables: [{ name: 'orders' }] },
      ],
    })

    expect(tables.map((table) => table.name)).toEqual(['users', 'orders'])
  })

  it('returns empty arrays when schema data is missing', () => {
    expect(getSchemaColumns(undefined)).toEqual([])
    expect(getSchemaTables(undefined)).toEqual([])
    expect(getPrimaryKeyColumns(undefined)).toEqual([])
    expect(getForeignKeys(undefined)).toEqual([])
  })
})
