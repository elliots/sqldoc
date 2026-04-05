import { describe, expect, it } from '@sqldoc/test-utils'
import { extractScheme, schemeToPackage } from '../db/plugin-resolver.ts'

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
      const { resolveAdapterPlugin } = await import('../db/plugin-resolver.ts')
      await expect(
        resolveAdapterPlugin({
          devUrl: 'fakescheme://localhost/db',
          context: { dialect: 'postgres', extensions: [] },
        }),
      ).rejects.toThrow('Database adapter @sqldoc/db-fakescheme is required')
    })
  })
})
