import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Walk up from startDir looking for .sqldoc/ directory.
 * Returns the absolute path to .sqldoc/ or null.
 */
export function findSqldocDir(startDir: string = process.cwd()): string | null {
  let current = resolve(startDir)
  while (true) {
    const candidate = join(current, '.sqldoc')
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = dirname(current)
    if (parent === current) {
      // Reached filesystem root
      return null
    }
    current = parent
  }
}
