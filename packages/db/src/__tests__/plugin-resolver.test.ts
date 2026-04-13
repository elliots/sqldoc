import { describe, expect, it } from '@sqldoc/test-utils'
import { extractScheme, resolveAdapterPlugin, schemeToPackage } from '../db/plugin-resolver.ts'
import type { DatabaseAdapter, DatabaseAdapterPlugin } from '../db/types.ts'

describe('plugin-resolver', () => {
  describe('extractScheme', () => {
    it('extracts scheme from URL', () => {
      expect(extractScheme('postgres://localhost/db')).toBe('postgres')
      expect(extractScheme('mysql://localhost/db')).toBe('mysql')
      expect(extractScheme('neon://ep-cool.us-east-2.aws.neon.tech/db')).toBe('neon')
    })

    it('returns bare string for non-URL', () => {
      expect(extractScheme('pglite')).toBe('pglite')
      expect(extractScheme(':memory:')).toBe(':memory:')
    })
  })

  describe('schemeToPackage', () => {
    it('maps scheme to package name', () => {
      expect(schemeToPackage('postgres')).toBe('@sqldoc/db-postgres')
      expect(schemeToPackage('neon')).toBe('@sqldoc/db-neon')
      expect(schemeToPackage('mysql')).toBe('@sqldoc/db-mysql')
    })

    it('resolves postgresql alias', () => {
      expect(schemeToPackage('postgresql')).toBe('@sqldoc/db-postgres')
    })
  })

  describe('tryImportPlugin error handling', () => {
    it('rethrows non-MODULE_NOT_FOUND errors from resolveAdapterPlugin', async () => {
      // Attempting to resolve a scheme with no built-in and no sqldocDir
      // should throw a descriptive error, not return null
      await expect(
        resolveAdapterPlugin({
          devUrl: 'fakescheme://localhost/db',
          context: { dialect: 'postgres', extensions: [] },
        }),
      ).rejects.toThrow('Database adapter @sqldoc/db-fakescheme is required')
    })
  })

  describe('adapterPlugin override', () => {
    it('uses a provided adapter plugin before built-in or external resolution', async () => {
      const adapter: DatabaseAdapter = {
        currentSchema: 'public',
        query: async () => ({ columns: [], rows: [] }),
        exec: async () => ({ rowsAffected: 0 }),
        close: async () => {},
      }
      const plugin: DatabaseAdapterPlugin = {
        apiVersion: 1,
        name: 'custom-postgres',
        schemes: ['postgres'],
        dialects: ['postgres'],
        runtime: 'any',
        createAdapter: async () => adapter,
      }

      await expect(
        resolveAdapterPlugin({
          devUrl: 'postgres://localhost/db',
          context: { dialect: 'postgres', extensions: [] },
          adapterPlugin: plugin,
        }),
      ).resolves.toBe(adapter)
    })
  })
})
