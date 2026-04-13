import { describe, expect, it } from '@sqldoc/test-utils'
import { getForeignKeys, getPrimaryKeyColumns, getSchemaColumns, getSchemaTables } from '../schema-context.ts'

describe('schema-context helpers', () => {
  it('reads primary key columns from canonical tables', () => {
    const columns = getPrimaryKeyColumns({
      name: 'users',
      columns: [],
      primaryKey: { parts: [{ column: 'id' }] },
    })

    expect(columns).toEqual(['id'])
  })

  it('returns canonical foreign keys unchanged', () => {
    const foreignKeys = getForeignKeys({
      name: 'orders',
      columns: [],
      foreignKeys: [{ columns: ['user_id'], refTable: 'users', refColumns: ['id'], symbol: 'orders_user_id_fkey' }],
    })

    expect(foreignKeys).toEqual([
      { columns: ['user_id'], refTable: 'users', refColumns: ['id'], symbol: 'orders_user_id_fkey' },
    ])
  })

  it('flattens tables from all schemas', () => {
    const tables = getSchemaTables({
      schemas: [
        { name: 'public', tables: [{ name: 'users', columns: [] }] },
        { name: 'tenant', tables: [{ name: 'orders', columns: [] }] },
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
