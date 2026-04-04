/**
 * Load a TypeScript or JavaScript module at runtime.
 *
 * - Bun: native import() for .ts files (including node_modules).
 * - Node 22.21+: native import() with type stripping (outside node_modules).
 * - For node_modules .ts on Node: pass a custom loader to loadImports() (VSCode does this).
 */

import { createRequire } from 'node:module'
import * as path from 'node:path'
import { debug } from './debug.ts'

const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts'])

/**
 * Import a TypeScript or JavaScript module by specifier.
 * Handles npm packages (via require.resolve), relative paths, and absolute paths.
 */
export async function tsImport(specifier: string, fromDir?: string): Promise<any> {
  const abs = resolveSpecifier(specifier, fromDir)
  debug('ts-import', `specifier=${specifier}, resolved=${abs}`)

  if (TS_EXTENSIONS.has(path.extname(abs))) {
    const isNodeModules = abs.includes('/node_modules/') || abs.includes('\\node_modules\\')
    if (isNodeModules && typeof process.versions?.bun !== 'string') {
      throw new Error(
        `Cannot import TypeScript from node_modules on Node.js: '${abs}'. Use Bun, or pass a custom loader.`,
      )
    }
  }

  return import(abs)
}

function resolveSpecifier(specifier: string, fromDir?: string): string {
  if (path.isAbsolute(specifier)) return specifier
  if (specifier.startsWith('.')) return path.resolve(specifier)

  // npm package — resolve from caller's directory (or cwd as fallback)
  const base = fromDir || process.cwd()
  const req = createRequire(path.join(base, 'noop.js'))
  return req.resolve(specifier)
}
