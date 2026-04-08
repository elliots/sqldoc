/**
 * Load a TypeScript or JavaScript module at runtime.
 *
 * - Bun: native import() for .ts files (including node_modules).
 * - Node 22.21+: native import() with type stripping.
 *   The sqldoc shim calls enableNodeModulesTypeStripping() which registers
 *   hooks to handle .ts under node_modules — so we just import() directly.
 */

import { createRequire } from 'node:module'
import * as path from 'node:path'
import { debug } from './debug.ts'

/**
 * Import a TypeScript or JavaScript module by specifier.
 * Handles npm packages (via require.resolve), relative paths, and absolute paths.
 */
export async function tsImport(specifier: string, fromDir?: string): Promise<any> {
  const abs = resolveSpecifier(specifier, fromDir)
  debug('ts-import', `specifier=${specifier}, resolved=${abs}`)
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
