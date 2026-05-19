import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

const neonUrl = process.env.TEST_NEON_DATABASE_URL

describe('db-neon adapter integration', () => {
  it('executes SQL against TEST_NEON_DATABASE_URL', {
    skip: neonUrl ? false : 'set TEST_NEON_DATABASE_URL to run live Neon adapter test',
  }, async () => {
    console.log('Testing Neon adapter with database URL:', neonUrl)
    const tableName = `sqldoc_adapter_smoke_${Date.now()}`
    const db = await plugin.createAdapter(neonUrl!, { dialect: 'postgres', extensions: [] })

    try {
      assert.equal(typeof db.currentSchema, 'string')
      assert.notEqual(db.currentSchema.length, 0)

      await db.exec(`DROP TABLE IF EXISTS ${tableName}`)
      await db.exec(`CREATE TABLE ${tableName} (id serial PRIMARY KEY, name text NOT NULL)`)
      const inserted = await db.exec(`INSERT INTO ${tableName} (name) VALUES ($1), ($2)`, ['alpha', 'beta'])
      assert.equal(inserted.rowsAffected, 2)

      const result = await db.query(`SELECT name FROM ${tableName} WHERE name <> $1 ORDER BY id`, ['skip'])
      assert.deepEqual(result.columns, ['name'])
      assert.deepEqual(result.rows, [['alpha'], ['beta']])
    } finally {
      try {
        await db.exec(`DROP TABLE IF EXISTS ${tableName}`)
      } finally {
        await db.close()
      }
    }
  })
})
