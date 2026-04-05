import pglitePlugin from '@sqldoc/db-pglite'
import { describe, expect, it } from '@sqldoc/test-utils'
import { extractExtensions, validatePostgresExtensions } from '../extensions.ts'
import { createRunner } from '../index.ts'

describe('extractExtensions', () => {
  it('extracts unquoted extension name', () => {
    expect(extractExtensions(['CREATE EXTENSION uuid_ossp;']).extensions).toEqual(['uuid_ossp'])
  })

  it('extracts quoted extension name', () => {
    expect(extractExtensions(['CREATE EXTENSION "uuid-ossp";']).extensions).toEqual(['uuid_ossp'])
  })

  it('handles IF NOT EXISTS', () => {
    expect(extractExtensions(['CREATE EXTENSION IF NOT EXISTS pg_trgm;']).extensions).toEqual(['pg_trgm'])
  })

  it('extracts multiple extensions from one file', () => {
    const sql = `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION pg_trgm;
      CREATE TABLE users (id uuid DEFAULT uuid_generate_v4());
    `
    const { extensions } = extractExtensions([sql])
    expect(extensions).toContain('uuid_ossp')
    expect(extensions).toContain('pg_trgm')
    expect(extensions).toHaveLength(2)
  })

  it('extracts from multiple files', () => {
    const { extensions } = extractExtensions(['CREATE EXTENSION citext;', 'CREATE EXTENSION IF NOT EXISTS hstore;'])
    expect(extensions).toContain('citext')
    expect(extensions).toContain('hstore')
  })

  it('deduplicates', () => {
    const { extensions } = extractExtensions(['CREATE EXTENSION pg_trgm;', 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'])
    expect(extensions).toEqual(['pg_trgm'])
  })

  it('returns empty for no extensions', () => {
    expect(extractExtensions(['CREATE TABLE users (id int);']).extensions).toEqual([])
  })

  it('normalizes hyphens to underscores', () => {
    expect(extractExtensions(['CREATE EXTENSION "uuid-ossp";']).extensions).toEqual(['uuid_ossp'])
  })

  it('is case insensitive', () => {
    expect(extractExtensions(['create extension PG_TRGM;']).extensions).toEqual(['pg_trgm'])
  })
})

describe('validatePostgresExtensions', () => {
  it('passes when all extensions available', async () => {
    const mockQuery = async () => ({
      rows: [['pg_trgm'], ['uuid_ossp']],
    })
    await validatePostgresExtensions(['pg_trgm', 'uuid_ossp'], mockQuery)
  })

  it('throws when extension missing', async () => {
    const mockQuery = async () => ({
      rows: [['pg_trgm']],
    })
    await expect(validatePostgresExtensions(['pg_trgm', 'missing_ext'], mockQuery)).rejects.toThrow(
      /not available on this database/,
    )
  })

  it('skips validation for empty list', async () => {
    const mockQuery = async () => {
      throw new Error('should not be called')
    }
    await validatePostgresExtensions([], mockQuery as any)
  })
})

describe('pglite extension loading (integration)', () => {
  it('loads uuid-ossp and generates UUIDs', async () => {
    const adapter = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: ['uuid_ossp'] })
    try {
      await adapter.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
      const result = await adapter.query('SELECT uuid_generate_v4() as id')
      expect(result.columns).toContain('id')
      const uuid = String(result.rows[0][0])
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    } finally {
      await adapter.close()
    }
  })

  it('loads citext and does case-insensitive comparison', async () => {
    const adapter = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: ['citext'] })
    try {
      await adapter.exec('CREATE EXTENSION IF NOT EXISTS citext')
      await adapter.exec('CREATE TABLE test_ci (email citext PRIMARY KEY)')
      await adapter.exec("INSERT INTO test_ci VALUES ('Hello@Example.COM')")
      const result = await adapter.query("SELECT * FROM test_ci WHERE email = 'hello@example.com'")
      expect(result.rows).toHaveLength(1)
    } finally {
      await adapter.close()
    }
  })

  it('loads extensions via createRunner config', async () => {
    const sql = `
      CREATE EXTENSION IF NOT EXISTS hstore;
      CREATE TABLE settings (id serial PRIMARY KEY, data hstore);
    `
    const runner = await createRunner({ dialect: 'postgres', extensions: ['hstore'] })
    try {
      const result = await runner.inspect([sql], { schema: 'public' })
      expect(result.error).toBe(undefined)
      const tables = result.schema?.schemas?.[0]?.tables ?? []
      expect(tables.some((t) => t.name === 'settings')).toBe(true)
    } finally {
      runner.close()
    }
  })
})
