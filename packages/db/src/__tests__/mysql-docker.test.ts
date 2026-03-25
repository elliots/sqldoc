import { afterAll, describe, expect, it } from 'vitest'
import { createMysqlDockerAdapter } from '../db/mysql-docker'
import type { DatabaseAdapter } from '../db/types'

describe('MySQL Docker adapter', () => {
  const adapters: DatabaseAdapter[] = []

  afterAll(async () => {
    for (const a of adapters) {
      await a.close()
    }
  })

  it('creates adapter from docker://mysql:8 image', async () => {
    const adapter = await createMysqlDockerAdapter('docker://mysql:8')
    adapters.push(adapter)

    const result = await adapter.query('SELECT 1 as num')
    expect(result.columns).toContain('num')
    expect(result.rows[0][0]).toBe(1)
  }, 120_000)

  it('can execute DDL and query tables', async () => {
    const adapter = await createMysqlDockerAdapter('docker://mysql:8')
    adapters.push(adapter)

    await adapter.exec('CREATE TABLE test_table (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL)')
    await adapter.exec("INSERT INTO test_table (name) VALUES ('hello')")

    const result = await adapter.query('SELECT * FROM test_table')
    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0][1]).toBe('hello')
  }, 120_000)

  it('exec reports rows affected for INSERT', async () => {
    const adapter = await createMysqlDockerAdapter('docker://mysql:8')
    adapters.push(adapter)

    await adapter.exec('CREATE TABLE affected_test (id INT AUTO_INCREMENT PRIMARY KEY, val TEXT)')
    const result = await adapter.exec("INSERT INTO affected_test (val) VALUES ('a'), ('b'), ('c')")
    expect(result.rowsAffected).toBe(3)
  }, 120_000)
})
