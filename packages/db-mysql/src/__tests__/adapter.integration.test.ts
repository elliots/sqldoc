import assert from 'node:assert/strict'
import { createContainerDbSource } from '@sqldoc/db'
import { describe, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('db-mysql adapter integration', () => {
  it('executes SQL against a Docker MySQL shadow database', async () => {
    const source = await createContainerDbSource({
      devUrl: 'docker://mysql:8',
      context: { dialect: 'mysql', extensions: [] },
      adapterPlugin: plugin,
    })

    try {
      const db = await source.open()
      try {
        assert.match(db.currentSchema, /^sqldoc_shadow_/)

        await db.exec('CREATE TABLE adapter_smoke (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL)')
        const inserted = await db.exec('INSERT INTO adapter_smoke (name) VALUES (?), (?)', ['alpha', 'beta'])
        assert.equal(inserted.rowsAffected, 2)

        const result = await db.query('SELECT name FROM adapter_smoke WHERE name <> ? ORDER BY id', ['skip'])
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
