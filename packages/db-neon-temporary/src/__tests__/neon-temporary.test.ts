/**
 * Integration test for @sqldoc/db-neon-temporary.
 *
 * Creates a real ephemeral Neon database via the Neon API.
 * Only runs when TEST_NEON=true is set.
 *
 * Example: TEST_NEON=true bun test packages/db-neon-temporary/ --timeout 120000
 */
import { describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('neon-temporary adapter', () => {
  if (process.env.TEST_NEON !== 'true') {
    it('skipped: set TEST_NEON=true to run', () => {})
    return
  }

  plugin.lockTimeoutMs = 5000

  it('creates database, wipes schema, provides clean slate', async () => {
    const adapter = await plugin.createAdapter('neon-temporary', { dialect: 'postgres', extensions: [] })
    try {
      // Schema should be empty after wipe
      const result = await adapter.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      )
      expect(result.rows).toHaveLength(0)

      // Can create tables
      await adapter.exec('CREATE TABLE test_neon (id serial PRIMARY KEY, name text)')
      const tables = await adapter.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      )
      expect(tables.rows).toHaveLength(1)
    } finally {
      await adapter.close()
    }
  })

  it('reuses cached database on second call', async () => {
    plugin.forceReuse = true
    try {
      const adapter = await plugin.createAdapter('neon-temporary', { dialect: 'postgres', extensions: [] })
      try {
        // Should connect without creating a new DB (reuses cache from previous test)
        const result = await adapter.query('SELECT 1 as ok')
        expect(result.rows[0][0]).toBe(1)
      } finally {
        await adapter.close()
      }
    } finally {
      plugin.forceReuse = false
    }
  })

  it('releases lock on close, allows next connection', async () => {
    const adapter = await plugin.createAdapter('neon-temporary', { dialect: 'postgres', extensions: [] })
    await adapter.close()

    // Should be able to reconnect immediately (lock released)
    const adapter2 = await plugin.createAdapter('neon-temporary', { dialect: 'postgres', extensions: [] })
    try {
      const result = await adapter2.query('SELECT 1 as ok')
      expect(result.rows[0][0]).toBe(1)
    } finally {
      await adapter2.close()
    }
  })
})
