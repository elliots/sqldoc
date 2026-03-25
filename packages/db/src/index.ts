// @sqldoc/db -- Atlas WASI integration for sqldoc
// Schema types, database adapters, and WASI runner

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDockerAdapter } from './db/docker.ts'
import { createMysqlDockerAdapter } from './db/mysql-docker.ts'
import { createMysqlAdapter } from './db/mysql.ts'
import { createPgliteAdapter } from './db/pglite.ts'
import { createPostgresAdapter } from './db/postgres.ts'
import { createSqliteAdapter } from './db/sqlite.ts'
import { extractExtensions, validatePgliteExtensions, validatePostgresExtensions } from './extensions.ts'
import { createAtlasRunner } from './runner.ts'

export { createDockerAdapter } from './db/docker.ts'
export { createMysqlDockerAdapter } from './db/mysql-docker.ts'
export { createMysqlAdapter } from './db/mysql.ts'
export { createPgliteAdapter } from './db/pglite.ts'
export { createPostgresAdapter } from './db/postgres.ts'
export { createSqliteAdapter } from './db/sqlite.ts'
export type { DatabaseAdapter, ExecResult, QueryResult } from './db/types.ts'
export { extractExtensions, validatePgliteExtensions, validatePostgresExtensions } from './extensions.ts'
export type { AtlasRunner, AtlasRunnerOptions } from './runner.ts'
export { createAtlasRunner } from './runner.ts'
export * from './types.ts'

export interface CreateRunnerConfig {
  /** SQL dialect (required) */
  dialect: 'postgres' | 'mysql' | 'sqlite'
  /** Database connection URL. If omitted, uses dialect-specific default. */
  devUrl?: string
  /** SQL file contents to scan for CREATE EXTENSION statements */
  sqlFiles?: string[]
}

/**
 * Resolve the atlas.wasm binary.
 * Binary mode: ATLAS_WASM_PATH env var set by binary entry point.
 * Dev mode: walk up from current directory to find atlas.wasm.
 */
function resolveWasm(): string {
  // Binary mode: WASM path set by binary entry point
  if (process.env.ATLAS_WASM_PATH) {
    return process.env.ATLAS_WASM_PATH
  }

  // Dev mode: walk up from current directory to find atlas.wasm
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

/** Return the default dev database URL for each dialect */
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
 * Resolves the wasm binary, detects extensions from SQL files,
 * validates them, and creates the appropriate DB adapter.
 */
export async function createRunner(config: CreateRunnerConfig): Promise<import('./runner').AtlasRunner> {
  const wasmPath = resolveWasm()
  const dialect = config.dialect
  const devUrl = config.devUrl ?? defaultDevUrl(dialect)

  // Extract extensions from SQL (postgres only)
  const { extensions } =
    dialect === 'postgres' && config.sqlFiles ? extractExtensions(config.sqlFiles) : { extensions: [] }

  let db: import('./db/types').DatabaseAdapter

  if (dialect === 'sqlite') {
    db = await createSqliteAdapter(devUrl)
  } else if (dialect === 'mysql') {
    if (devUrl.startsWith('docker://')) {
      db = await createMysqlDockerAdapter(devUrl)
    } else {
      db = await createMysqlAdapter(devUrl)
    }
  } else {
    // postgres (existing logic preserved exactly)
    if (devUrl.startsWith('docker://') || devUrl.startsWith('dockerfile://')) {
      db = await createDockerAdapter(devUrl)
      if (extensions.length > 0) {
        await validatePostgresExtensions(extensions, (sql) => db.query(sql))
      }
    } else if (devUrl.startsWith('postgres://') || devUrl.startsWith('postgresql://')) {
      db = await createPostgresAdapter(devUrl)
      if (extensions.length > 0) {
        await validatePostgresExtensions(extensions, (sql) => db.query(sql))
      }
    } else {
      // pglite (in-memory embedded postgres)
      const validExtensions = extensions.length > 0 ? await validatePgliteExtensions(extensions) : []
      db = await createPgliteAdapter(validExtensions.length > 0 ? validExtensions : undefined)
    }
  }

  return createAtlasRunner({ wasmPath, db, dialect })
}
