import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createDockerAdapter } from '../db/docker'
import type { DatabaseAdapter } from '../db/types'

describe('Docker adapter', () => {
  const adapters: DatabaseAdapter[] = []

  afterAll(async () => {
    for (const a of adapters) {
      await a.close()
    }
  })

  it('creates adapter from docker:// image', async () => {
    const adapter = await createDockerAdapter('docker://postgres:16')
    adapters.push(adapter)

    const result = await adapter.query('SELECT 1 as num')
    expect(result.columns).toContain('num')
    expect(result.rows[0][0]).toBe(1)
  }, 60_000)

  it('can execute DDL and query tables', async () => {
    const adapter = await createDockerAdapter('docker://postgres:16')
    adapters.push(adapter)

    await adapter.exec('CREATE TABLE test_table (id serial PRIMARY KEY, name text NOT NULL)')
    await adapter.exec("INSERT INTO test_table (name) VALUES ('hello')")

    const result = await adapter.query('SELECT * FROM test_table')
    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0][1]).toBe('hello')
  }, 60_000)

  it('creates adapter from dockerfile://', async () => {
    // Create a minimal Dockerfile
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-docker-test-'))
    const dockerfile = path.join(tmpDir, 'Dockerfile')
    fs.writeFileSync(dockerfile, 'FROM postgres:16\n')

    try {
      const adapter = await createDockerAdapter(`dockerfile://${dockerfile}`)
      adapters.push(adapter)

      const result = await adapter.query('SELECT current_database()')
      expect(result.rows[0][0]).toBe('sqldoc_dev')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 120_000)

  it('works with createRunner docker:// scheme', async () => {
    const { createRunner } = await import('../index')
    const runner = await createRunner({ dialect: 'postgres', devUrl: 'docker://postgres:16' })

    try {
      const result = await runner.inspect(['CREATE TABLE docker_test (id bigserial PRIMARY KEY, name text);'], {
        schema: 'public',
        dialect: 'postgres',
      })

      expect(result.error).toBeUndefined()
      expect(result.schema).toBeDefined()
      const tables = result.schema!.schemas[0]?.tables ?? []
      expect(tables.some((t) => t.name === 'docker_test')).toBe(true)
    } finally {
      await runner.close()
    }
  }, 60_000)
})
