import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Walk up from startDir looking for a .sqldoc/ directory.
 * Returns the absolute path to .sqldoc/ or null if not found.
 */
export function findSqldocDir(startDir: string = process.cwd()): string | null {
  let current = path.resolve(startDir)
  while (true) {
    const candidate = path.join(current, '.sqldoc')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * Unwrap nested ESM default exports.
 *
 * CJS interop can double-wrap: `{ default: { default: actualExport } }`.
 * Keeps unwrapping `mod.default` until `isTarget(mod)` returns true
 * (meaning we've reached the real export) or there's nothing left to unwrap.
 */
export function unwrapDefault<T>(mod: any, isTarget: (m: any) => boolean): T {
  while (mod && typeof mod === 'object' && 'default' in mod && !isTarget(mod)) {
    mod = mod.default
  }
  return mod as T
}
