import * as fs from 'node:fs'
import * as path from 'node:path'

/** A migration file read from the migrations directory */
export interface MigrationFile {
  /** Filename (e.g. "20260321143000_initial.sql") */
  filename: string
  /** Full file content */
  content: string
  /** Timestamp prefix extracted from filename (before first underscore) */
  timestamp: string
}

/**
 * Read all migration files from a directory, sorted lexicographically (chronological).
 * Returns empty array if directory doesn't exist.
 */
export function readMigrationDir(dir: string): MigrationFile[] {
  const absDir = path.resolve(dir)
  if (!fs.existsSync(absDir)) return []

  const files = fs
    .readdirSync(absDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  return files.map((filename) => ({
    filename,
    content: fs.readFileSync(path.join(absDir, filename), 'utf-8'),
    timestamp: filename.split('_')[0],
  }))
}

/**
 * Generate a timestamped migration filename.
 * Format: YYYYMMDDHHMMSS_name.sql
 *
 * Name is sanitized: lowercased, non-alphanumeric replaced with underscore,
 * leading/trailing underscores stripped. Defaults to "migration" if empty.
 */
export function migrationFilename(name: string): string {
  const now = new Date()
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')

  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return `${ts}_${safeName || 'migration'}.sql`
}

/**
 * Write a migration file to the migrations directory.
 * Creates the directory recursively if it doesn't exist.
 * Statements are joined with ";\n" and a trailing ";\n" is appended.
 * Returns the absolute path of the written file.
 */
export function writeMigrationFile(dir: string, filename: string, statements: string[]): string {
  const absDir = path.resolve(dir)
  fs.mkdirSync(absDir, { recursive: true })

  const content = `${statements.join(';\n')};\n`
  const filePath = path.join(absDir, filename)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}
