import * as fs from 'node:fs'
import * as path from 'node:path'
import fg from 'fast-glob'

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
  const files = await fg(patterns, {
    cwd: resolved,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/__tests__/**', '**/test/**', '**/*.test.*', '**/dist/**', '**/.sqldoc/**'],
  })

  return files.sort()
}
