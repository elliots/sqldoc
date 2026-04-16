import type { DbSource } from '@sqldoc/inspector'
import { after, describe, expect, it } from '@sqldoc/test-utils'
import { createContainerDbSource } from '../db/dbsource-container.ts'

describe('MySQL Docker container DbSource', () => {
  const sources: DbSource[] = []

  after(async () => {
    for (const s of sources) {
      await s.close()
    }
  })

  it('opens a shadow db from docker://mysql:8 image', async () => {
    const source = await createContainerDbSource({
      devUrl: 'docker://mysql:8',
      context: { dialect: 'mysql', extensions: [] },
    })
    sources.push(source)

    const db = await source.open()
    try {
      const result = await db.query('SELECT 1 as num')
      expect(result.columns).toHaveLength(1)
      expect(result.rows[0][0]).toBe(1)
    } finally {
      await db.close()
    }
  })

  it('can execute DDL and query tables in a shadow db', async () => {
    const source = await createContainerDbSource({
      devUrl: 'docker://mysql:8',
      context: { dialect: 'mysql', extensions: [] },
    })
    sources.push(source)

    const db = await source.open()
    try {
      await db.exec('CREATE TABLE test_table (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL)')
      await db.exec("INSERT INTO test_table (name) VALUES ('hello')")

      const result = await db.query('SELECT * FROM test_table')
      expect(result.columns).toHaveLength(2)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0][1]).toBe('hello')
    } finally {
      await db.close()
    }
  })

  it('exec reports rows affected for INSERT', async () => {
    const source = await createContainerDbSource({
      devUrl: 'docker://mysql:8',
      context: { dialect: 'mysql', extensions: [] },
    })
    sources.push(source)

    const db = await source.open()
    try {
      await db.exec('CREATE TABLE affected_test (id INT AUTO_INCREMENT PRIMARY KEY, val TEXT)')
      const result = await db.exec("INSERT INTO affected_test (val) VALUES ('a'), ('b'), ('c')")
      expect(result.rowsAffected).toBe(3)
    } finally {
      await db.close()
    }
  })
})
