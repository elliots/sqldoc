/**
 * Realm inspection with content-hash cache.
 *
 * All callers should operate on realms end-to-end: produce realms from the
 * appropriate source, then feed them to `diffRealms()` (pure TS, no DB).
 *
 * Realm sources:
 *
 *  - `{kind: 'sql'}` — a set of SQL file contents to run through a shadow DB.
 *    Cacheable: byte-identical inputs → byte-identical realm → no DB round-trip.
 *
 *  - `{kind: 'db'}` — a live database URL. Always re-inspected; live DB state is
 *    never guaranteed stable.
 */

import type { DatabaseEngine, Realm } from '@sqldoc/core'
import { getEngineSpec } from '@sqldoc/core'
import type { OnMissingPlugin } from '@sqldoc/db'
import { createRunner, inspectAdapter, resolveAdapterPlugin } from '@sqldoc/db'
import { computeRealmCacheKey, readRealmCache, writeRealmCache } from './cache.ts'

export interface InspectRealmConfig {
  engine: DatabaseEngine
  dialect: string
  extensions: string[]
  /** Shadow DB URL used when inspecting SQL contents. */
  devUrl?: string
  sqldocDir?: string
  onMissingPlugin?: OnMissingPlugin
}

/** SQL source: inspect SQL content arrays in a shadow DB. Cacheable. */
export interface SqlRealmSource {
  kind: 'sql'
  /** SQL file contents, in dependency order. */
  contents: string[]
  /** Relative file paths (for stable cache keys). If omitted, contents are keyed by index. */
  relFiles?: string[]
  /** Pass through to the inspector (e.g. schema name filter). */
  schema?: string
  /** Disambiguator in the cache key — lets different calls share or separate entries. */
  tag: string
}

/** Live DB source: inspect a running database directly. Not cached. */
export interface DbRealmSource {
  kind: 'db'
  devUrl: string
  schema?: string
}

export type RealmSource = SqlRealmSource | DbRealmSource

/** Produce a Realm from any supported source, using cache where safe. */
export async function inspectRealm(
  source: RealmSource,
  config: InspectRealmConfig,
  cacheDir: string | undefined,
): Promise<Realm> {
  if (source.kind === 'db') {
    return inspectLiveDb(source, config)
  }
  return inspectSql(source, config, cacheDir)
}

async function inspectSql(
  source: SqlRealmSource,
  config: InspectRealmConfig,
  cacheDir: string | undefined,
): Promise<Realm> {
  const files = source.contents.map((content, i) => ({
    relPath: source.relFiles?.[i] ?? `#${i}`,
    content,
  }))

  const key = computeRealmCacheKey({
    tag: source.tag,
    engine: config.engine,
    dialect: config.dialect,
    extensions: config.extensions,
    schema: source.schema,
    files,
  })

  const cached = readRealmCache(cacheDir, key)
  if (cached) return cached

  const runner = await createRunner({
    engine: config.engine,
    devUrl: config.devUrl,
    extensions: config.extensions,
    sqldocDir: config.sqldocDir,
    onMissingPlugin: config.onMissingPlugin,
  })
  try {
    const result = await runner.inspect(source.contents, {
      schema: source.schema,
      fileNames: source.relFiles,
    })
    if (!result.schema) {
      throw new Error(result.error ?? 'Schema inspection failed to parse schema')
    }
    writeRealmCache(cacheDir, key, result.schema)
    return result.schema
  } finally {
    await runner.close()
  }
}

/**
 * Inspect a live DB URL directly (no shadow). Connects with `resolveAdapterPlugin`
 * so the adapter opens the exact database named in the URL, then inspects it
 * through `inspectAdapter`. Not cached — live DB state is never guaranteed stable.
 */
async function inspectLiveDb(source: DbRealmSource, config: InspectRealmConfig): Promise<Realm> {
  const dialect = getEngineSpec(config.engine).dialect
  const adapter = await resolveAdapterPlugin({
    devUrl: source.devUrl,
    context: { dialect, extensions: config.extensions },
    sqldocDir: config.sqldocDir,
    onMissingPlugin: config.onMissingPlugin,
  })
  try {
    return await inspectAdapter(config.engine, adapter, { schema: source.schema })
  } finally {
    await adapter.close()
  }
}
