/**
 * Compilation cache for sqldoc pipeline.
 *
 * Two cache layers live under `.sqldoc/cache/`:
 *
 * 1. Realm inspection cache (`realm-*.json`): skips `runner.inspect()` when the
 *    complete set of project/external/include SQL files is byte-identical to a
 *    previous run, for the same engine/dialect/extensions.
 *
 * 2. Per-file compile cache (`compile-*.json`): skips `compile()` when this
 *    file's content, the full realm-inputs set, all loaded plugin files, and
 *    the relevant config slice are unchanged.
 *
 * Bump CACHE_SCHEMA_VERSION whenever the cached JSON shape changes.
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CompilerOutput, Realm, ResolvedConfig } from '@sqldoc/core'
import { debug } from '@sqldoc/core'

const CACHE_SCHEMA_VERSION = 1

const LOCAL_PLUGIN_EXTS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'])

export function isCacheDisabled(): boolean {
  return process.env.SQLDOC_NO_CACHE === 'true' || process.env.SQLDOC_NO_CACHE === '1'
}

/** Get the cache directory for a given sqldoc dir, creating it if needed. Returns null if no sqldoc dir. */
export function getCacheDir(sqldocDir: string | undefined): string | undefined {
  if (!sqldocDir) return undefined
  const dir = path.join(sqldocDir, 'cache')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function hashParts(parts: Array<string | Buffer>): string {
  const h = crypto.createHash('sha256')
  for (const p of parts) {
    // Length-prefix each part so concatenation is unambiguous
    if (typeof p === 'string') {
      h.update(`${p.length}:`)
      h.update(p)
    } else {
      h.update(`${p.byteLength}:`)
      h.update(p)
    }
  }
  return h.digest('hex')
}

/** Read a file's contents, returning empty buffer on missing. */
function readFileSafe(filePath: string): Buffer {
  try {
    return fs.readFileSync(filePath)
  } catch {
    return Buffer.alloc(0)
  }
}

// ── Realm cache ─────────────────────────────────────────────────────

export interface RealmCacheInputs {
  /** All SQL file contents in deterministic order (sorted by file path). */
  files: Array<{ relPath: string; content: string }>
  engine: string
  dialect: string
  /** DB extensions extracted from SQL. */
  extensions: string[]
  /** Schema used by inspector (defaults, etc.) */
  schema?: string
  /** Tag that identifies this inspection call — e.g. 'full' or 'external'. */
  tag: string
}

export function computeRealmCacheKey(inputs: RealmCacheInputs): string {
  const parts: string[] = [
    `v${CACHE_SCHEMA_VERSION}`,
    `tag:${inputs.tag}`,
    `engine:${inputs.engine}`,
    `dialect:${inputs.dialect}`,
    `schema:${inputs.schema ?? ''}`,
    `extensions:${[...inputs.extensions].sort().join(',')}`,
  ]
  // Files in stable order
  const sortedFiles = [...inputs.files].sort((a, b) => a.relPath.localeCompare(b.relPath))
  for (const f of sortedFiles) {
    parts.push(`file:${f.relPath}`)
    parts.push(`content:${f.content}`)
  }
  return hashParts(parts)
}

interface RealmCacheEntry {
  schemaVersion: number
  createdAt: string
  realm: Realm
}

export function readRealmCache(cacheDir: string | undefined, key: string): Realm | undefined {
  if (!cacheDir || isCacheDisabled()) return undefined
  const file = path.join(cacheDir, `realm-${key}.json`)
  if (!fs.existsSync(file)) return undefined
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf-8')) as RealmCacheEntry
    if (entry.schemaVersion !== CACHE_SCHEMA_VERSION) return undefined
    debug('cache', `realm hit: ${path.basename(file)}`)
    return entry.realm
  } catch (err: any) {
    debug('cache', `realm read error: ${err?.message ?? String(err)}`)
    return undefined
  }
}

export function writeRealmCache(cacheDir: string | undefined, key: string, realm: Realm): void {
  if (!cacheDir || isCacheDisabled()) return
  const file = path.join(cacheDir, `realm-${key}.json`)
  const entry: RealmCacheEntry = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    realm,
  }
  try {
    fs.writeFileSync(file, JSON.stringify(entry), 'utf-8')
    debug('cache', `realm write: ${path.basename(file)}`)
  } catch (err: any) {
    debug('cache', `realm write error: ${err?.message ?? String(err)}`)
  }
}

// ── Per-file compile cache ──────────────────────────────────────────

export interface CompileCacheInputs {
  /** Absolute path of the SQL file (used for identity, not content). */
  filePath: string
  /** Final SQL content after @include inlining — what actually feeds compile(). */
  source: string
  /** Import paths from the SQL file's @import lines. */
  importPaths: string[]
  /** Project config (dialect/engine/namespaces slice are hashed). */
  config: ResolvedConfig
  /** Realm inputs hash — ties per-file cache to the realm inputs. */
  realmKey: string
  /** sqldoc dir (used to resolve plugin files). */
  sqldocDir: string | undefined
}

/**
 * Resolve plugin files for a single SQL file. Returns absolute file paths in
 * stable order. We include:
 *  - Every file in `.sqldoc/plugins/` (auto-registered local plugins).
 *  - Each `@import` path resolved to a concrete file on disk. For package
 *    imports we hash the package's `package.json` plus its main entry.
 */
function resolvePluginFiles(importPaths: string[], sqlFilePath: string, sqldocDir: string | undefined): string[] {
  const files: string[] = []
  const sqlDir = path.dirname(sqlFilePath)

  if (sqldocDir) {
    const pluginsDir = path.join(sqldocDir, 'plugins')
    if (fs.existsSync(pluginsDir)) {
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true })
      for (const e of entries) {
        if (!e.isFile()) continue
        if (e.name.startsWith('.')) continue
        if (!LOCAL_PLUGIN_EXTS.has(path.extname(e.name))) continue
        files.push(path.join(pluginsDir, e.name))
      }
    }
  }

  for (const importPath of importPaths) {
    if (importPath.startsWith('.') || importPath.startsWith('/')) {
      const abs = path.resolve(sqlDir, importPath)
      if (fs.existsSync(abs)) files.push(abs)
      continue
    }
    // Package import — hash package.json + main entry
    if (sqldocDir) {
      const pkgDir = path.join(sqldocDir, 'node_modules', importPath)
      const pkgJsonPath = path.join(pkgDir, 'package.json')
      if (fs.existsSync(pkgJsonPath)) {
        files.push(pkgJsonPath)
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
          const entry = pkg.module ?? pkg.main
          if (entry) {
            const entryPath = path.join(pkgDir, entry)
            if (fs.existsSync(entryPath)) files.push(entryPath)
          }
        } catch {
          // ignore malformed package.json — package.json hash still participates
        }
      }
    }
  }

  return [...new Set(files)].sort()
}

export function computeCompileCacheKey(inputs: CompileCacheInputs): string {
  const { filePath, source, importPaths, config, realmKey, sqldocDir } = inputs

  const pluginFiles = resolvePluginFiles(importPaths, filePath, sqldocDir)
  const pluginHash = hashParts(pluginFiles.flatMap((f) => [`plugin:${f}`, readFileSafe(f)] as Array<string | Buffer>))

  // Only hash the config slice that affects compilation
  const configSlice = {
    engine: config.engine,
    dialect: config.dialect,
    namespaces: config.namespaces ?? {},
  }

  const parts: string[] = [
    `v${CACHE_SCHEMA_VERSION}`,
    `realm:${realmKey}`,
    `file:${filePath}`,
    `source:${sha256(source)}`,
    `plugins:${pluginHash}`,
    `config:${sha256(JSON.stringify(configSlice))}`,
  ]
  return hashParts(parts)
}

interface CompileCacheEntry {
  schemaVersion: number
  createdAt: string
  output: CompilerOutput
}

export function readCompileCache(cacheDir: string | undefined, key: string): CompilerOutput | undefined {
  if (!cacheDir || isCacheDisabled()) return undefined
  const file = path.join(cacheDir, `compile-${key}.json`)
  if (!fs.existsSync(file)) return undefined
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf-8')) as CompileCacheEntry
    if (entry.schemaVersion !== CACHE_SCHEMA_VERSION) return undefined
    debug('cache', `compile hit: ${path.basename(file)}`)
    return entry.output
  } catch (err: any) {
    debug('cache', `compile read error: ${err?.message ?? String(err)}`)
    return undefined
  }
}

export function writeCompileCache(cacheDir: string | undefined, key: string, output: CompilerOutput): void {
  if (!cacheDir || isCacheDisabled()) return
  const file = path.join(cacheDir, `compile-${key}.json`)
  const entry: CompileCacheEntry = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    output,
  }
  try {
    fs.writeFileSync(file, JSON.stringify(entry), 'utf-8')
    debug('cache', `compile write: ${path.basename(file)}`)
  } catch (err: any) {
    debug('cache', `compile write error: ${err?.message ?? String(err)}`)
  }
}
