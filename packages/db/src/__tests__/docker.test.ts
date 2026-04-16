import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { DbSource } from '@sqldoc/inspector'
import { after, describe, expect, it } from '@sqldoc/test-utils'
import { createContainerDbSource } from '../db/dbsource-container.ts'

describe('Docker container DbSource', () => {
  const sources: DbSource[] = []

  after(async () => {
    for (const s of sources) {
      await s.close()
    }
  })

  it('opens a shadow db from docker:// image', async () => {
    const source = await createContainerDbSource({
      devUrl: 'docker://postgres:16',
      context: { dialect: 'postgres', extensions: [] },
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

  it('each open() returns an isolated empty db', async () => {
    const source = await createContainerDbSource({
      devUrl: 'docker://postgres:16',
      context: { dialect: 'postgres', extensions: [] },
    })
    sources.push(source)

    const db1 = await source.open()
    await db1.exec('CREATE TABLE test_table (id serial PRIMARY KEY, name text NOT NULL)')
    await db1.exec("INSERT INTO test_table (name) VALUES ('hello')")

    const db2 = await source.open()
    try {
      const result = await db2.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
      // db2 should be empty — test_table only exists in db1
      expect(result.rows).toHaveLength(0)
    } finally {
      await db2.close()
    }

    const result = await db1.query('SELECT * FROM test_table')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0][1]).toBe('hello')
    await db1.close()
  })

  it('creates source from dockerfile://', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-docker-test-'))
    const dockerfile = path.join(tmpDir, 'Dockerfile')
    fs.writeFileSync(dockerfile, 'FROM postgres:16\n')

    try {
      const source = await createContainerDbSource({
        devUrl: `dockerfile://${dockerfile}`,
        context: { dialect: 'postgres', extensions: [] },
      })
      sources.push(source)

      const db = await source.open()
      try {
        const result = await db.query('SELECT 1 as num')
        expect(result.rows[0][0]).toBe(1)
      } finally {
        await db.close()
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('works with createRunner docker:// scheme', async () => {
    const { createRunner } = await import('../index.ts')
    const runner = await createRunner({ engine: 'postgres', devUrl: 'docker://postgres:16' })

    try {
      const result = await runner.inspect(['CREATE TABLE docker_test (id bigserial PRIMARY KEY, name text);'], {
        schema: 'public',
      })

      expect(result.error).toBe(undefined)
      expect(result.schema).not.toBe(undefined)
      const tables = result.schema!.schemas[0]?.tables ?? []
      expect(tables.some((t) => t.name === 'docker_test')).toBe(true)
    } finally {
      await runner.close()
    }
  })
})
