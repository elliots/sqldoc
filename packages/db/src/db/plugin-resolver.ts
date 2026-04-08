/**
 * Database adapter plugin resolution.
 *
 * All adapters — built-in and external — go through the same plugin interface.
 * Built-in adapters (Bun SQL, SQLite) register themselves in the plugin map
 * at import time. External adapters are loaded from .sqldoc/node_modules/
 * and auto-installed on first use.
 */

import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AdapterPluginContext, DatabaseAdapter, DatabaseAdapterPlugin } from './types.ts'
import { createBunSqlAdapter, isBun } from './types.ts'

const log = process.env.DEBUG ? (msg: string) => console.error(`[plugin] ${msg}`) : () => {}

// ── Built-in plugin registry ───────────────────────────────────────

const builtinPlugins = new Map<string, DatabaseAdapterPlugin>()

/** Register a built-in adapter plugin (called at module load time) */
export function registerBuiltin(plugin: DatabaseAdapterPlugin) {
  for (const scheme of plugin.schemes) {
    builtinPlugins.set(scheme, plugin)
  }
}

// Register SQLite (works on both Bun and Node via bun:sqlite / node:sqlite)
registerBuiltin({
  apiVersion: 1,
  name: 'sqlite',
  schemes: ['sqlite', ':memory:'],
  dialects: ['sqlite'],
  runtime: 'any',
  async createAdapter(devUrl: string, _context: AdapterPluginContext): Promise<DatabaseAdapter> {
    const { createSqliteAdapter } = await import('./sqlite.ts')
    return createSqliteAdapter(devUrl === ':memory:' ? ':memory:' : devUrl.replace(/^sqlite:\/\//, ''))
  },
})

// Register Bun built-in SQL adapters (postgres + mysql) when running on Bun
if (isBun) {
  registerBuiltin({
    apiVersion: 1,
    name: 'bun-postgres',
    schemes: ['postgres', 'postgresql'],
    dialects: ['postgres'],
    runtime: 'bun',
    async createAdapter(connectionString: string, _context: AdapterPluginContext): Promise<DatabaseAdapter> {
      return createBunSqlAdapter(connectionString)
    },
  })

  // Bun SQL doesn't handle multi-statement DDL batches correctly (partial execution
  // before error causes Atlas fallback to fail). Use @sqldoc/db-mysql (mysql2) instead.
}

// ── Scheme resolution ──────────────────────────────────────────────

/** Scheme aliases — only for schemes that don't follow the @sqldoc/db-{scheme} convention */
const SCHEME_ALIASES: Record<string, string> = {
  postgresql: 'postgres',
}

/** Extract the URL scheme from a devUrl, or return the keyword itself for bare strings */
export function extractScheme(devUrl: string): string {
  const match = devUrl.match(/^([a-z][a-z0-9_-]*):\/\//)
  return match ? match[1] : devUrl
}

/** Map a scheme to an external package name */
export function schemeToPackage(scheme: string): string {
  const resolved = SCHEME_ALIASES[scheme] ?? scheme
  return `@sqldoc/db-${resolved}`
}

// ── Auto-install callback ──────────────────────────────────────────

/** Called when a plugin package is not installed. Returns true if install succeeded. */
export type OnMissingPlugin = (packageName: string, version: string) => Promise<boolean>

// ── Resolver ───────────────────────────────────────────────────────

export interface ResolvePluginOptions {
  devUrl: string
  context: AdapterPluginContext
  /** Path to .sqldoc/ directory for package resolution */
  sqldocDir?: string
  /** Called when plugin package is missing. Triggers auto-install. */
  onMissingPlugin?: OnMissingPlugin
}

/**
 * Resolve and load a database adapter plugin for the given devUrl.
 * Checks built-in registry first, then external packages.
 */
function validatePlugin(
  plugin: DatabaseAdapterPlugin,
  label: string,
  scheme: string,
  context: AdapterPluginContext,
): void {
  if (plugin.apiVersion !== 1) {
    throw new Error(`${label} has unsupported apiVersion ${plugin.apiVersion} (expected 1).`)
  }
  if (!plugin.schemes.includes(scheme)) {
    throw new Error(`${label} does not handle scheme '${scheme}'. It handles: ${plugin.schemes.join(', ')}`)
  }
  if (!plugin.dialects.includes(context.dialect)) {
    throw new Error(
      `${label} does not support dialect '${context.dialect}'. It supports: ${plugin.dialects.join(', ')}`,
    )
  }
  if (plugin.runtime !== 'any') {
    const currentRuntime = isBun ? 'bun' : 'node'
    if (plugin.runtime !== currentRuntime) {
      throw new Error(`${label} requires '${plugin.runtime}' but running on '${currentRuntime}'.`)
    }
  }
}

export async function resolveAdapterPlugin(options: ResolvePluginOptions): Promise<DatabaseAdapter> {
  const { devUrl, context, sqldocDir, onMissingPlugin } = options
  const scheme = extractScheme(devUrl)

  // Check built-in plugins first
  const builtin = builtinPlugins.get(scheme)
  if (builtin) {
    log(`using built-in '${builtin.name}' for scheme '${scheme}'`)
    validatePlugin(builtin, `built-in '${builtin.name}'`, scheme, context)
    return builtin.createAdapter(devUrl, context)
  }

  // External plugin resolution
  const packageName = schemeToPackage(scheme)
  log(`resolving ${packageName} for scheme '${scheme}'`)

  let mod = await tryImportPlugin(packageName, sqldocDir)

  // Not found — try auto-install
  if (!mod) {
    const version = getOwnVersion()
    log(`${packageName} not found, attempting install @${version}`)

    if (!onMissingPlugin) {
      throw new Error(
        `Database adapter ${packageName} is required for devUrl '${devUrl}'. ` +
          `Install it: sqldoc add ${packageName}@${version}`,
      )
    }

    const installed = await onMissingPlugin(`${packageName}@${version}`, version)
    if (!installed) {
      throw new Error(`Database adapter ${packageName} is required for devUrl '${devUrl}' but was not installed.`)
    }

    mod = await tryImportPlugin(packageName, sqldocDir)
    if (!mod) {
      throw new Error(`Failed to load ${packageName} after installation.`)
    }
  }

  // Unwrap default export
  const plugin: DatabaseAdapterPlugin = mod.default ?? mod
  log(`loaded ${plugin.name} (api=${plugin.apiVersion}, runtime=${plugin.runtime})`)
  validatePlugin(plugin, packageName, scheme, context)

  return plugin.createAdapter(devUrl, context)
}

// ── Helpers ────────────────────────────────────────────────────────

function isModuleNotFound(err: any): boolean {
  return err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND'
}

async function tryImportPlugin(packageName: string, sqldocDir?: string): Promise<any | null> {
  if (sqldocDir) {
    try {
      const req = createRequire(path.join(sqldocDir, 'node_modules', '.placeholder'))
      const resolved = req.resolve(packageName)
      return await import(resolved)
    } catch (err: any) {
      if (!isModuleNotFound(err)) throw err
    }
  }

  for (const base of [import.meta.url, path.join(process.cwd(), '.placeholder')]) {
    try {
      const req = createRequire(base)
      const resolved = req.resolve(packageName)
      return await import(resolved)
    } catch (err: any) {
      if (!isModuleNotFound(err)) throw err
    }
  }
  return null
}

function getOwnVersion(): string {
  try {
    const req = createRequire(import.meta.url)
    const pkgPath = req.resolve('@sqldoc/db/package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    return pkg.version
  } catch {
    try {
      const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      return pkg.version
    } catch {
      return '0.0.0'
    }
  }
}
