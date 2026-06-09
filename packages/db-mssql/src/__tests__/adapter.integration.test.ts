import assert from 'node:assert/strict'
import { createContainerDbSource } from '@sqldoc/db'
import { describe, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('db-mssql adapter integration', () => {
  it('executes SQL against a Docker SQL Server shadow database', async () => {
    const source = await createContainerDbSource({
      devUrl: 'docker://mcr.microsoft.com/mssql/server:2022-latest',
      context: { dialect: 'mssql', extensions: [] },
      adapterPlugin: plugin,
    })

    try {
      const db = await source.open()
      try {
        assert.equal(db.currentSchema, 'dbo')

        await db.exec('CREATE TABLE adapter_smoke (id INT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(255) NOT NULL)')
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
