/**
 * Resolves @import paths and loads TagNamespace definitions.
 *
 * Local plugins placed in `.sqldoc/plugins/` are auto-loaded and made
 * available to every SQL file — no @import line required.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { debug } from './debug.ts'
import { tsImport as defaultLoader } from './ts-import.ts'
import type { TagNamespace } from './types.ts'
import { findSqldocDir, unwrapDefault } from './utils.ts'

/** @deprecated Use setDebugLogger() from @sqldoc/core instead */
export function setImportLogger(_logger: (msg: string) => void) {
  // No-op — loader now uses the shared debug() from debug.ts
}

function log(msg: string) {
  debug('loader', msg)
}

export interface LoadResult {
  namespaces: Map<string, TagNamespace>
  errors: ImportError[]
}

export interface ImportError {
  importPath: string
  message: string
}

const LOCAL_PLUGIN_EXTS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'])
// Keyed by loader identity → sqldocDir so that callers using different loaders
// (e.g. a test stub vs. the real tsImport) don't share cached results.
type Loader = (specifier: string, fromDir?: string) => Promise<any>
const localPluginCache = new Map<Loader, Map<string, Promise<LoadResult>>>()

/** Clear the local plugin cache. Used by tests and when .sqldoc/plugins/ changes. */
export function clearLocalPluginCache() {
  localPluginCache.clear()
}

/**
 * Load all files in `.sqldoc/plugins/` as TagNamespace plugins.
 * Results are cached per (loader, sqldocDir) for the process lifetime.
 */
export async function loadLocalPlugins(sqldocDir: string, loader?: Loader): Promise<LoadResult> {
  const load = loader ?? defaultLoader
  let byDir = localPluginCache.get(load)
  if (!byDir) {
    byDir = new Map()
    localPluginCache.set(load, byDir)
  }
  const cached = byDir.get(sqldocDir)
  if (cached) return cached

  const task = (async (): Promise<LoadResult> => {
    const namespaces = new Map<string, TagNamespace>()
    const errors: ImportError[] = []
    const pluginsDir = path.join(sqldocDir, 'plugins')

    if (!fs.existsSync(pluginsDir)) {
      log(`loadLocalPlugins: no plugins dir at ${pluginsDir}`)
      return { namespaces, errors }
    }

    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true })
    const files = entries
      .filter((e) => e.isFile() && LOCAL_PLUGIN_EXTS.has(path.extname(e.name)) && !e.name.startsWith('.'))
      .map((e) => path.join(pluginsDir, e.name))
      .sort()

    log(`loadLocalPlugins: found ${files.length} file(s) in ${pluginsDir}`)

    for (const file of files) {
      try {
        let mod = (await load(file, pluginsDir)) as any
        mod = unwrapDefault(mod, (m: any) => !!m?.name && !!m?.tags)
        const ns = mod as TagNamespace | undefined
        if (!ns || !ns.name || !ns.tags) {
          errors.push({
            importPath: file,
            message: `Plugin in .sqldoc/plugins does not export a valid TagNamespace (expected { name, tags })`,
          })
          continue
        }
        if (namespaces.has(ns.name)) {
          errors.push({
            importPath: file,
            message: `Duplicate plugin namespace '${ns.name}' in .sqldoc/plugins`,
          })
          continue
        }
        namespaces.set(ns.name, ns)
        log(`loadLocalPlugins: registered '${ns.name}' from ${path.basename(file)}`)
      } catch (err: any) {
        errors.push({ importPath: file, message: err?.message ?? String(err) })
      }
    }

    return { namespaces, errors }
  })().catch((err) => {
    byDir.delete(sqldocDir)
    throw err
  })

  byDir.set(sqldocDir, task)
  return task
}

/**
 * Load all imported tag namespaces for a SQL file.
 *
 * Resolution order:
 * - Plugins in `.sqldoc/plugins/` are auto-registered (no @import needed)
 * - Relative paths (./foo.ts): resolved from the SQL file's directory
 * - Package names (@sqldoc/ns-audit): resolved from .sqldoc/node_modules/
 */
export async function loadImports(
  importPaths: string[],
  sqlFilePath: string | undefined,
  loader?: (specifier: string, fromDir?: string) => Promise<any>,
): Promise<LoadResult> {
  const namespaces = new Map<string, TagNamespace>()
  const errors: ImportError[] = []

  if (!sqlFilePath) {
    errors.push({ importPath: '*', message: 'Cannot resolve imports for unsaved files' })
    return { namespaces, errors }
  }

  const sqlDir = path.dirname(sqlFilePath)
  log(`loadImports: sqlDir=${sqlDir}, paths=[${importPaths.join(', ')}]`)

  // Find .sqldoc/ for package resolution
  const sqldocDir = findSqldocDir(sqlDir)
  log(`loadImports: sqldocDir=${sqldocDir ?? 'null'}`)

  // Auto-register plugins from .sqldoc/plugins/ — available to every SQL file
  if (sqldocDir) {
    const local = await loadLocalPlugins(sqldocDir, loader)
    for (const [name, ns] of local.namespaces) {
      namespaces.set(name, ns)
    }
    errors.push(...local.errors)
  }

  for (const importPath of importPaths) {
    try {
      let resolved: string
      let resolveDir: string

      if (importPath.startsWith('.')) {
        // Relative path — resolve from the SQL file's directory
        resolved = path.resolve(sqlDir, importPath)
        resolveDir = sqlDir
      } else if (process.env.SQLDOC_RESOLVE_FROM_LOCAL_PACKAGE === 'true') {
        // Monorepo/development — resolve from the SQL file's directory (workspace packages)
        resolved = importPath
        resolveDir = sqlDir
      } else if (sqldocDir) {
        // Package name — resolve from .sqldoc/node_modules/
        resolved = importPath
        resolveDir = path.join(sqldocDir, 'node_modules')
      } else {
        throw new Error(
          `Cannot resolve '${importPath}': no .sqldoc/node_modules/ found. Run 'sqldoc init' first, or set SQLDOC_RESOLVE_FROM_LOCAL_PACKAGE=true for monorepo development.`,
        )
      }

      log(`loadImports: importing '${importPath}' resolved='${resolved}' resolveDir='${resolveDir}'`)
      const load = loader ?? defaultLoader
      let mod = (await load(resolved, resolveDir)) as any
      log(`loadImports: loaded '${importPath}' ok`)
      // Unwrap ESM default exports (CJS compat can double-wrap: { default: { default: plugin } })
      mod = unwrapDefault(mod, (m: any) => !!m.name)
      const ns = mod as TagNamespace | undefined

      if (!ns || !ns.name || !ns.tags) {
        errors.push({
          importPath,
          message: `Module does not export a valid TagNamespace (expected { name, tags })`,
        })
        continue
      }

      namespaces.set(ns.name, ns)
    } catch (err: any) {
      log(`loadImports: FAILED '${importPath}': ${err?.message ?? String(err)}`)
      if (err?.message?.includes('no .sqldoc/node_modules/')) {
        throw err
      }
      errors.push({
        importPath,
        message: err?.message ?? String(err),
      })
    }
  }

  return { namespaces, errors }
}
