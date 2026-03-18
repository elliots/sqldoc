/**
 * Resolves @import paths and loads TagNamespace definitions.
 * Uses tsx to handle TypeScript files without pre-compilation.
 */

import * as path from 'node:path'
import { tsImport } from './ts-import.ts'
import type { TagNamespace } from './types.ts'
import { findSqldocDir, unwrapDefault } from './utils.ts'

/** Pluggable logger — extension sets this to OutputChannel, CLI can set to console */
let log: (msg: string) => void = () => {}
export function setImportLogger(logger: (msg: string) => void) {
  log = logger
}

export interface LoadResult {
  namespaces: Map<string, TagNamespace>
  errors: ImportError[]
}

export interface ImportError {
  importPath: string
  message: string
}

/**
 * Load all imported tag namespaces for a SQL file.
 *
 * Resolution order:
 * - Relative paths (./foo.ts): resolved from the SQL file's directory
 * - Package names (@sqldoc/ns-audit): resolved from .sqldoc/node_modules/
 */
export async function loadImports(importPaths: string[], sqlFilePath: string | undefined): Promise<LoadResult> {
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

  for (const importPath of importPaths) {
    try {
      let resolved: string
      let resolveDir: string

      if (importPath.startsWith('.')) {
        // Relative path — resolve from the SQL file's directory
        resolved = path.resolve(sqlDir, importPath)
        resolveDir = sqlDir
      } else if (sqldocDir) {
        // Package name — resolve from .sqldoc/node_modules/
        resolved = importPath
        resolveDir = path.join(sqldocDir, 'node_modules')
      } else if (process.env.SQLDOC_RESOLVE_FROM_LOCAL_PACKAGE === 'true') {
        // Explicit fallback — resolve from the SQL file's directory (monorepo/development)
        resolved = importPath
        resolveDir = sqlDir
      } else {
        throw new Error(
          `Cannot resolve '${importPath}': no .sqldoc/node_modules/ found. Run 'sqldoc init' first, or set SQLDOC_RESOLVE_FROM_LOCAL_PACKAGE=true for monorepo development.`,
        )
      }

      log(`loadImports: importing '${importPath}' resolved='${resolved}' resolveDir='${resolveDir}'`)
      let mod = (await tsImport(resolved, resolveDir)) as any
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
