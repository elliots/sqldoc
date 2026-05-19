import assert from 'node:assert/strict'
import { createContainerDbSource } from '@sqldoc/db'
import { describe, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('db-postgres adapter integration', () => {
  it('executes SQL against a Docker PostgreSQL shadow database', async () => {
    const source = await createContainerDbSource({
      devUrl: 'docker://postgres:16',
      context: { dialect: 'postgres', extensions: [] },
      adapterPlugin: plugin,
    })

    try {
      const db = await source.open()
      try {
        assert.equal(db.currentSchema, 'public')

        await db.exec('CREATE TABLE adapter_smoke (id serial PRIMARY KEY, name text NOT NULL)')
        const inserted = await db.exec("INSERT INTO adapter_smoke (name) VALUES ('alpha'), ('beta')")
        assert.equal(inserted.rowsAffected, 2)

        const result = await db.query('SELECT name FROM adapter_smoke WHERE name <> $1 ORDER BY id', ['skip'])
        assert.deepEqual(result.columns, ['name'])
        assert.deepEqual(result.rows, [['alpha'], ['beta']])
      } finally {
        await db.close()
      }
    } finally {
      await source.close()
    }
  })
})
