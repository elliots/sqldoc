// @sqldoc/db -- Atlas WASI integration for sqldoc
// Schema types, database adapters, and WASI runner

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMysqlDockerAdapter } from './db/mysql-docker.ts'
import type { OnMissingPlugin } from './db/plugin-resolver.ts'
import { resolveAdapterPlugin } from './db/plugin-resolver.ts'
import { createPostgresDockerAdapter } from './db/postgres-docker.ts'
import { validatePostgresExtensions } from './extensions.ts'
import { createAtlasRunner } from './runner.ts'

export { createMysqlDockerAdapter } from './db/mysql-docker.ts'
export type { OnMissingPlugin } from './db/plugin-resolver.ts'
export { extractScheme, registerBuiltin, resolveAdapterPlugin, schemeToPackage } from './db/plugin-resolver.ts'
export { createPostgresDockerAdapter } from './db/postgres-docker.ts'
export { createSqliteAdapter } from './db/sqlite.ts'
export type {
  AdapterPluginContext,
  DatabaseAdapter,
  DatabaseAdapterPlugin,
  ExecResult,
  QueryResult,
} from './db/types.ts'
export { createBunSqlAdapter, isBun, normalizeValue } from './db/types.ts'
export { extractExtensions, validatePostgresExtensions } from './extensions.ts'
export type { AtlasRunner, AtlasRunnerOptions, DiffSource } from './runner.ts'
export { createAtlasRunner } from './runner.ts'
export * from './types.ts'

export interface CreateRunnerConfig {
  /** SQL dialect (required) */
  dialect: 'postgres' | 'mysql' | 'sqlite'
  /** Database connection URL. If omitted, uses dialect-specific default. */
  devUrl?: string
  /** Postgres extensions to load. Validated against the dev database. */
  extensions?: string[]
  /** Path to .sqldoc/ directory for plugin package resolution */
  sqldocDir?: string
  /** Called when a plugin package is missing. CLI provides auto-install. */
  onMissingPlugin?: OnMissingPlugin
}

/**
 * Resolve the atlas.wasm binary.
 */
function resolveWasm(): string {
  if (process.env.ATLAS_WASM_PATH) {
    return process.env.ATLAS_WASM_PATH
  }

  let dir = path.dirname(fileURLToPath(import.meta.url))
  while (true) {
    for (const candidate of [
      path.join(dir, 'wasm', 'atlas.wasm'),
      path.join(dir, '..', 'wasm', 'atlas.wasm'),
      path.join(dir, 'node_modules', '@sqldoc', 'db', 'wasm', 'atlas.wasm'),
      path.join(dir, 'packages', 'db', 'wasm', 'atlas.wasm'),
    ]) {
      if (fs.existsSync(candidate)) return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    'atlas.wasm not found. Set ATLAS_WASM_PATH or build: cd atlas/cmd/atlas-wasi && GOOS=wasip1 GOARCH=wasm go build -o atlas.wasm .',
  )
}

function defaultDevUrl(dialect: 'postgres' | 'mysql' | 'sqlite'): string {
  switch (dialect) {
    case 'postgres':
      return 'pglite'
    case 'sqlite':
      return ':memory:'
    case 'mysql':
      return 'docker://mysql:8'
  }
}

/**
 * Create an Atlas runner with sensible defaults.
 *
 * All adapters go through the plugin resolver. Built-in plugins (Bun SQL,
 * SQLite) are registered at import time. External plugins (@sqldoc/db-*)
 * are loaded from .sqldoc/node_modules/ and auto-installed on first use.
 *
 * Docker is the only special case — it orchestrates a container, then
 * delegates to the plugin system for the actual DB connection.
 */
export async function createRunner(config: CreateRunnerConfig): Promise<import('./runner').AtlasRunner> {
  const wasmPath = resolveWasm()
  const dialect = config.dialect
  const devUrl = config.devUrl ?? defaultDevUrl(dialect)
  const extensions = dialect === 'postgres' ? (config.extensions ?? []) : []
  const pluginOpts = {
    context: { dialect, extensions },
    sqldocDir: config.sqldocDir,
    onMissingPlugin: config.onMissingPlugin,
  }

  let db: import('./db/types').DatabaseAdapter

  if (devUrl.startsWith('docker://') || devUrl.startsWith('dockerfile://')) {
    // Docker orchestration: spin up container, then the inner adapter
    // handles Bun vs Node via the plugin system
    if (dialect === 'mysql') {
      db = await createMysqlDockerAdapter(devUrl, pluginOpts)
    } else {
      db = await createPostgresDockerAdapter(devUrl, pluginOpts)
    }
  } else {
    // Everything else goes through plugin resolution
    db = await resolveAdapterPlugin({ devUrl, ...pluginOpts })
  }

  // Validate postgres extensions against the live database
  if (dialect === 'postgres' && extensions.length > 0) {
    if (process.env.DEBUG) console.error(`[runner] validating extensions: ${extensions.join(', ')}`)
    await validatePostgresExtensions(extensions, (sql) => db.query(sql))
    if (process.env.DEBUG) console.error('[runner] extensions validated')
  }

  return createAtlasRunner({ wasmPath, db, dialect })
}
