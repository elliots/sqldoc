import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { CompilerOutput, Realm, ResolvedConfig } from '@sqldoc/core'
import { afterEach, beforeEach, describe, expect, it } from '@sqldoc/test-utils'
import {
  computeCompileCacheKey,
  computeRealmCacheKey,
  getCacheDir,
  isCacheDisabled,
  readCompileCache,
  readRealmCache,
  writeCompileCache,
  writeRealmCache,
} from '../utils/cache.ts'

function makeRealm(): Realm {
  return {
    defaultSchema: 'public',
    schemas: [{ name: 'public', tables: [{ name: 't', columns: [] }], views: [] }],
  } as unknown as Realm
}

function makeOutput(): CompilerOutput {
  return {
    sourceFile: '/x/y.sql',
    mergedSql: 'SELECT 1;',
    sqlOutputs: [],
    codeOutputs: [],
    errors: [],
    docsMeta: [],
    fileTags: [],
  }
}

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    engine: 'postgres',
    dialect: 'postgres',
    namespaces: {},
    ...overrides,
  } as ResolvedConfig
}

describe('cache module', () => {
  let tmp: string
  let sqldocDir: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-cache-'))
    sqldocDir = path.join(tmp, '.sqldoc')
    fs.mkdirSync(sqldocDir, { recursive: true })
    delete process.env.SQLDOC_NO_CACHE
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
    delete process.env.SQLDOC_NO_CACHE
  })

  describe('getCacheDir', () => {
    it('returns undefined when no sqldoc dir', () => {
      expect(getCacheDir(undefined)).toBe(undefined)
    })

    it('creates and returns cache dir inside sqldoc dir', () => {
      const dir = getCacheDir(sqldocDir)
      expect(dir).toBe(path.join(sqldocDir, 'cache'))
      expect(fs.existsSync(dir!)).toBe(true)
    })
  })

  describe('isCacheDisabled', () => {
    it('is false by default', () => {
      expect(isCacheDisabled()).toBe(false)
    })

    it('is true when SQLDOC_NO_CACHE=true', () => {
      process.env.SQLDOC_NO_CACHE = 'true'
      expect(isCacheDisabled()).toBe(true)
    })

    it('is true when SQLDOC_NO_CACHE=1', () => {
      process.env.SQLDOC_NO_CACHE = '1'
      expect(isCacheDisabled()).toBe(true)
    })
  })

  describe('computeRealmCacheKey', () => {
    const base = {
      tag: 'full',
      engine: 'postgres',
      dialect: 'postgres',
      extensions: [],
      files: [{ relPath: 'a.sql', content: 'CREATE TABLE a();' }],
    }

    it('is stable for identical inputs', () => {
      expect(computeRealmCacheKey(base)).toBe(computeRealmCacheKey(base))
    })

    it('is sensitive to file content', () => {
      const a = computeRealmCacheKey(base)
      const b = computeRealmCacheKey({
        ...base,
        files: [{ relPath: 'a.sql', content: 'CREATE TABLE a(x int);' }],
      })
      expect(a).not.toBe(b)
    })

    it('is sensitive to file path', () => {
      const a = computeRealmCacheKey(base)
      const b = computeRealmCacheKey({ ...base, files: [{ relPath: 'b.sql', content: 'CREATE TABLE a();' }] })
      expect(a).not.toBe(b)
    })

    it('is sensitive to engine', () => {
      const a = computeRealmCacheKey(base)
      const b = computeRealmCacheKey({ ...base, engine: 'crdb' })
      expect(a).not.toBe(b)
    })

    it('is sensitive to dialect', () => {
      const a = computeRealmCacheKey(base)
      const b = computeRealmCacheKey({ ...base, dialect: 'mysql' })
      expect(a).not.toBe(b)
    })

    it('is sensitive to extensions', () => {
      const a = computeRealmCacheKey({ ...base, extensions: ['uuid-ossp'] })
      const b = computeRealmCacheKey({ ...base, extensions: ['pg_trgm'] })
      expect(a).not.toBe(b)
    })

    it('is sensitive to tag so full vs external keys never collide', () => {
      const a = computeRealmCacheKey(base)
      const b = computeRealmCacheKey({ ...base, tag: 'external' })
      expect(a).not.toBe(b)
    })

    it('is order-insensitive for files list (sorted internally)', () => {
      const a = computeRealmCacheKey({
        ...base,
        files: [
          { relPath: 'a.sql', content: 'A' },
          { relPath: 'b.sql', content: 'B' },
        ],
      })
      const b = computeRealmCacheKey({
        ...base,
        files: [
          { relPath: 'b.sql', content: 'B' },
          { relPath: 'a.sql', content: 'A' },
        ],
      })
      expect(a).toBe(b)
    })
  })

  describe('computeCompileCacheKey', () => {
    const base = {
      filePath: '/project/x.sql',
      source: 'SELECT 1;',
      importPaths: [],
      config: makeConfig(),
      realmKey: 'realm-abc',
      sqldocDir: undefined,
    }

    it('is stable for identical inputs', () => {
      expect(computeCompileCacheKey(base)).toBe(computeCompileCacheKey(base))
    })

    it('is sensitive to source', () => {
      const a = computeCompileCacheKey(base)
      const b = computeCompileCacheKey({ ...base, source: 'SELECT 2;' })
      expect(a).not.toBe(b)
    })

    it('is sensitive to realmKey — any project-wide change busts per-file caches', () => {
      const a = computeCompileCacheKey(base)
      const b = computeCompileCacheKey({ ...base, realmKey: 'realm-xyz' })
      expect(a).not.toBe(b)
    })

    it('is sensitive to namespaces config', () => {
      const a = computeCompileCacheKey(base)
      const b = computeCompileCacheKey({
        ...base,
        config: makeConfig({ namespaces: { audit: { table: 'audit_log' } } }),
      })
      expect(a).not.toBe(b)
    })

    it('is sensitive to dialect/engine config', () => {
      const a = computeCompileCacheKey(base)
      const b = computeCompileCacheKey({ ...base, config: makeConfig({ dialect: 'mysql', engine: 'mysql' }) })
      expect(a).not.toBe(b)
    })

    it('hashes local plugin files from .sqldoc/plugins/', () => {
      const pluginsDir = path.join(sqldocDir, 'plugins')
      fs.mkdirSync(pluginsDir, { recursive: true })
      const plugin = path.join(pluginsDir, 'custom.ts')
      fs.writeFileSync(plugin, `export default { name: 'custom', tags: {} }`)

      const a = computeCompileCacheKey({ ...base, sqldocDir })
      fs.writeFileSync(plugin, `export default { name: 'custom', tags: { x: {} } }`)
      const b = computeCompileCacheKey({ ...base, sqldocDir })
      expect(a).not.toBe(b)
    })

    it('hashes package.json of imported packages', () => {
      const pkgDir = path.join(sqldocDir, 'node_modules', '@sqldoc', 'ns-test')
      fs.mkdirSync(pkgDir, { recursive: true })
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@sqldoc/ns-test', version: '1.0.0' }))

      const a = computeCompileCacheKey({ ...base, importPaths: ['@sqldoc/ns-test'], sqldocDir })
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@sqldoc/ns-test', version: '1.0.1' }))
      const b = computeCompileCacheKey({ ...base, importPaths: ['@sqldoc/ns-test'], sqldocDir })
      expect(a).not.toBe(b)
    })
  })

  describe('read/write round-trip', () => {
    it('realm: miss when nothing cached, hit after write', () => {
      const cacheDir = getCacheDir(sqldocDir)!
      expect(readRealmCache(cacheDir, 'k1')).toBe(undefined)
      const realm = makeRealm()
      writeRealmCache(cacheDir, 'k1', realm)
      const loaded = readRealmCache(cacheDir, 'k1')
      expect(loaded).toEqual(realm)
    })

    it('compile: miss when nothing cached, hit after write', () => {
      const cacheDir = getCacheDir(sqldocDir)!
      expect(readCompileCache(cacheDir, 'k1')).toBe(undefined)
      const out = makeOutput()
      writeCompileCache(cacheDir, 'k1', out)
      const loaded = readCompileCache(cacheDir, 'k1')
      expect(loaded).toEqual(out)
    })

    it('reads return undefined when cache is disabled via env', () => {
      const cacheDir = getCacheDir(sqldocDir)!
      writeRealmCache(cacheDir, 'k1', makeRealm())
      writeCompileCache(cacheDir, 'k1', makeOutput())

      process.env.SQLDOC_NO_CACHE = 'true'
      expect(readRealmCache(cacheDir, 'k1')).toBe(undefined)
      expect(readCompileCache(cacheDir, 'k1')).toBe(undefined)
    })

    it('writes are no-ops when cache is disabled', () => {
      const cacheDir = getCacheDir(sqldocDir)!
      process.env.SQLDOC_NO_CACHE = 'true'
      writeRealmCache(cacheDir, 'k1', makeRealm())
      writeCompileCache(cacheDir, 'k1', makeOutput())
      expect(fs.readdirSync(cacheDir).length).toBe(0)
    })

    it('returns undefined when entry schemaVersion mismatches', () => {
      const cacheDir = getCacheDir(sqldocDir)!
      fs.writeFileSync(
        path.join(cacheDir, 'realm-old.json'),
        JSON.stringify({ schemaVersion: 0, createdAt: 'x', realm: makeRealm() }),
      )
      expect(readRealmCache(cacheDir, 'old')).toBe(undefined)
    })

    it('returns undefined on malformed cache entry', () => {
      const cacheDir = getCacheDir(sqldocDir)!
      fs.writeFileSync(path.join(cacheDir, 'compile-bad.json'), '{ not json')
      expect(readCompileCache(cacheDir, 'bad')).toBe(undefined)
    })
  })
})
