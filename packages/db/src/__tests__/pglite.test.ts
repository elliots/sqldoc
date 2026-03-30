import { after, before, describe, expect, it } from '@sqldoc/test-utils'
import { createPgliteAdapter } from '../db/pglite.ts'
import type { DatabaseAdapter } from '../db/types.ts'

describe('pglite adapter', () => {
  let adapter: DatabaseAdapter

  before(async () => {
    adapter = await createPgliteAdapter()
  })

  after(async () => {
    await adapter.close()
  })

  it('createPgliteAdapter returns object with query, exec, close methods', () => {
    expect(typeof adapter.query).toBe('function')
    expect(typeof adapter.exec).toBe('function')
    expect(typeof adapter.close).toBe('function')
  })

  it('query("SELECT 1 as num") returns expected shape', async () => {
    const result = await adapter.query('SELECT 1 as num')
    expect(result.columns).toEqual(['num'])
    expect(result.rows).toEqual([[1]])
  })

  it('exec("CREATE TABLE ...") succeeds for DDL', async () => {
    const result = await adapter.exec(
      'CREATE TABLE test_tbl (id serial PRIMARY KEY, name text NOT NULL, active boolean DEFAULT true)',
    )
    expect('rowsAffected' in result).toBeTruthy()
    expect(typeof result.rowsAffected).toBe('number')
  })

  it('query information_schema returns column metadata for created table', async () => {
    const result = await adapter.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'test_tbl' ORDER BY ordinal_position",
    )
    expect(result.columns).toEqual(['column_name', 'data_type'])
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toEqual(['id', 'integer'])
    expect(result.rows[1]).toEqual(['name', 'text'])
    expect(result.rows[2]).toEqual(['active', 'boolean'])
  })

  it('exec("INSERT ...") reports rows affected', async () => {
    const result = await adapter.exec("INSERT INTO test_tbl (name) VALUES ('alice')")
    expect(result.rowsAffected).toBe(1)
  })

  it('query with args works for parameterized queries', async () => {
    const result = await adapter.query('SELECT name FROM test_tbl WHERE name = $1', ['alice'])
    expect(result.columns).toEqual(['name'])
    expect(result.rows).toEqual([['alice']])
  })
})
