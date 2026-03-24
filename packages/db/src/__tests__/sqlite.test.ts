import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSqliteAdapter } from '../db/sqlite'
import type { DatabaseAdapter } from '../db/types'

describe('SQLite adapter', () => {
  let adapter: DatabaseAdapter

  beforeAll(async () => {
    adapter = await createSqliteAdapter(':memory:')
  })

  afterAll(async () => {
    await adapter.close()
  })

  it('createSqliteAdapter returns object with query, exec, close methods', () => {
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
      'CREATE TABLE test_tbl (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, active INTEGER DEFAULT 1)',
    )
    expect(result).toHaveProperty('rowsAffected')
    expect(typeof result.rowsAffected).toBe('number')
  })

  it('exec("INSERT ...") with args reports rows affected', async () => {
    const result = await adapter.exec('INSERT INTO test_tbl (name) VALUES (?)', ['alice'])
    expect(result.rowsAffected).toBe(1)
  })

  it('query returns inserted data', async () => {
    const result = await adapter.query('SELECT name, active FROM test_tbl WHERE name = ?', ['alice'])
    expect(result.columns).toEqual(['name', 'active'])
    expect(result.rows).toEqual([['alice', 1]])
  })

  it('exec with multi-statement DDL works', async () => {
    await adapter.exec('CREATE TABLE t2 (a TEXT); CREATE TABLE t3 (b INTEGER);')
    const result = await adapter.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('t2','t3') ORDER BY name",
    )
    expect(result.rows.map((r) => r[0])).toEqual(['t2', 't3'])
  })
})
