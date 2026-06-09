import assert from 'node:assert/strict'
import type { DatabaseAdapter } from '@sqldoc/db'
import { after, before, describe, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('db-pglite adapter package', () => {
  let adapter: DatabaseAdapter

  before(async () => {
    adapter = await plugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
  })

  after(async () => {
    await adapter.close()
  })

  it('exports postgres pglite plugin metadata', () => {
    assert.equal(plugin.apiVersion, 1)
    assert.equal(plugin.name, 'pglite')
    assert.deepEqual(plugin.schemes, ['pglite'])
    assert.deepEqual(plugin.dialects, ['postgres'])
  })

  it('queries and executes SQL in an in-memory database', async () => {
    await adapter.exec('CREATE TABLE test_tbl (id serial PRIMARY KEY, name text NOT NULL)')
    await adapter.exec("INSERT INTO test_tbl (name) VALUES ('alice')")

    const result = await adapter.query('SELECT name FROM test_tbl WHERE name = $1', ['alice'])

    assert.deepEqual(result.columns, ['name'])
    assert.deepEqual(result.rows, [['alice']])
  })
})
