import * as fs from 'node:fs'
import * as path from 'node:path'

const IGNORE_DIRS = new Set(['node_modules', '__tests__', 'test', 'dist', '.sqldoc'])

/**
 * Discover SQL files from a path. If inputPath is a .sql file, returns it directly.
 * If a directory, globs for SQL files within it.
 * Returns absolute paths sorted lexicographically for deterministic ordering.
 */
export async function discoverSqlFiles(inputPath: string, includePatterns?: string[]): Promise<string[]> {
  const resolved = path.resolve(inputPath)

  // Single file
  if (resolved.endsWith('.sql')) {
    if (!fs.existsSync(resolved)) {
      throw new Error(`SQL file not found: ${resolved}`)
    }
    return [resolved]
  }

  // Directory
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Path is not a file or directory: ${resolved}`)
  }

  const patterns = includePatterns ?? ['**/*.sql']
  const matches = fs.globSync(patterns, {
    cwd: resolved,
    exclude: (name) => IGNORE_DIRS.has(name),
  })

  const files = matches.map((f) => path.resolve(resolved, f)).filter((f) => fs.statSync(f).isFile())

  return files.sort()
}
