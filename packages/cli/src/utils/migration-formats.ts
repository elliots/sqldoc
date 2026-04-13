/**
 * Format-aware migration file reading and writing.
 *
 * Each format has its own conventions for:
 * - File naming and patterns
 * - Up/down script extraction from file content
 * - Writing new migration files with up+down sections
 *
 * Supported formats:
 * - plain:          NNN_name.sql (entire file = up, no down)
 * - goose:          NNN_name.sql (-- +goose Up / -- +goose Down markers)
 * - golang-migrate: NNN_name.up.sql / NNN_name.down.sql (separate files)
 * - flyway:         V1__name.sql (up), U1__name.sql (down/undo)
 * - dbmate:         NNN_name.sql (-- migrate:up / -- migrate:down markers)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { MigrationFormat } from '@sqldoc/core'

// ── Types ────────────────────────────────────────────────────────────

/** A parsed migration with its up and optional down SQL */
export interface ParsedMigration {
  /** Filename (primary file, e.g. "001_init.sql" or "001_init.up.sql") */
  filename: string
  /** The up (forward) SQL */
  up: string
  /** The down (rollback) SQL, if available */
  down?: string
  /** Sort key extracted from filename for ordering */
  sortKey: string
}

/** Options for writing a new migration file */
export interface WriteMigrationOptions {
  /** Directory to write to */
  dir: string
  /** Migration name (e.g. "add_users") */
  name: string
  /** Up SQL content */
  up: string
  /** Down SQL content (optional) */
  down?: string
  /** Format to write in */
  format: MigrationFormat
  /** Naming strategy */
  naming: 'timestamp' | 'sequential'
  /** Existing migrations (for sequential naming) */
  existing?: ParsedMigration[]
}

// ── Format-specific parsers ──────────────────────────────────────────

/** Parse a single migration file based on format */
function parsePlain(filename: string, content: string): ParsedMigration {
  const sortKey = filename.split('_')[0]
  return { filename, up: content.trim(), sortKey }
}

function parseGoose(filename: string, content: string): ParsedMigration {
  const sortKey = filename.split('_')[0]

  // Find the positions of -- +goose Up and -- +goose Down markers
  const upIdx = content.search(/^--\s*\+goose\s+Up\s*$/m)
  const downIdx = content.search(/^--\s*\+goose\s+Down\s*$/m)

  let up: string
  let down: string | undefined

  if (upIdx !== -1) {
    // Find end of the Up marker line
    const afterUp = content.indexOf('\n', upIdx)
    if (downIdx !== -1) {
      up = content.substring(afterUp + 1, downIdx).trim()
      const afterDown = content.indexOf('\n', downIdx)
      down = content.substring(afterDown + 1).trim() || undefined
    } else {
      up = content.substring(afterUp + 1).trim()
    }
  } else {
    up = content.trim()
  }

  return { filename, up, down, sortKey }
}

function parseDbmate(filename: string, content: string): ParsedMigration {
  const sortKey = filename.split('_')[0]

  // Find the positions of -- migrate:up and -- migrate:down markers
  const upIdx = content.search(/^--\s*migrate:up\s*$/m)
  const downIdx = content.search(/^--\s*migrate:down\s*$/m)

  let up: string
  let down: string | undefined

  if (upIdx !== -1) {
    const afterUp = content.indexOf('\n', upIdx)
    if (downIdx !== -1) {
      up = content.substring(afterUp + 1, downIdx).trim()
      const afterDown = content.indexOf('\n', downIdx)
      down = content.substring(afterDown + 1).trim() || undefined
    } else {
      up = content.substring(afterUp + 1).trim()
    }
  } else {
    up = content.trim()
  }

  return { filename, up, down, sortKey }
}

// ── Directory readers ────────────────────────────────────────────────

/**
 * Read and parse all migrations from a directory in the given format.
 * Returns migrations sorted by their sort key (chronological order).
 */
export function readMigrations(dir: string, format: MigrationFormat): ParsedMigration[] {
  const absDir = path.resolve(dir)
  if (!fs.existsSync(absDir)) return []

  const allFiles = fs
    .readdirSync(absDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  switch (format) {
    case 'plain':
      return allFiles.map((f) => {
        const content = fs.readFileSync(path.join(absDir, f), 'utf-8')
        return parsePlain(f, content)
      })

    case 'goose':
      return allFiles.map((f) => {
        const content = fs.readFileSync(path.join(absDir, f), 'utf-8')
        return parseGoose(f, content)
      })

    case 'golang-migrate':
      return readGolangMigrate(absDir, allFiles)

    case 'flyway':
      return readFlyway(absDir, allFiles)

    case 'dbmate':
      return allFiles.map((f) => {
        const content = fs.readFileSync(path.join(absDir, f), 'utf-8')
        return parseDbmate(f, content)
      })
  }
}

/** golang-migrate: pair .up.sql and .down.sql files */
function readGolangMigrate(absDir: string, files: string[]): ParsedMigration[] {
  const upFiles = files.filter((f) => f.includes('.up.sql'))
  return upFiles.map((upFile) => {
    const downFile = upFile.replace('.up.sql', '.down.sql')
    const upContent = fs.readFileSync(path.join(absDir, upFile), 'utf-8').trim()
    const downContent = files.includes(downFile)
      ? fs.readFileSync(path.join(absDir, downFile), 'utf-8').trim()
      : undefined

    // Sort key: everything before .up.sql
    const sortKey = upFile.replace('.up.sql', '').split('_')[0]
    return { filename: upFile, up: upContent, down: downContent || undefined, sortKey }
  })
}

/** flyway: V{n}__{name}.sql (up) and U{n}__{name}.sql (undo/down) */
function readFlyway(absDir: string, files: string[]): ParsedMigration[] {
  const vFiles = files.filter((f) => /^V\d+/.test(f))
  return vFiles.map((vFile) => {
    const upContent = fs.readFileSync(path.join(absDir, vFile), 'utf-8').trim()

    // Find matching U file: V1__name.sql -> U1__name.sql
    const versionMatch = vFile.match(/^V(\d+)/)
    const version = versionMatch ? versionMatch[1] : ''
    const uFile = files.find((f) => f.startsWith(`U${version}`))
    const downContent = uFile ? fs.readFileSync(path.join(absDir, uFile), 'utf-8').trim() : undefined

    return { filename: vFile, up: upContent, down: downContent || undefined, sortKey: version.padStart(6, '0') }
  })
}

// ── File writers ─────────────────────────────────────────────────────

/**
 * Write a new migration file in the given format.
 * Returns the absolute path(s) of written files.
 */
export function writeMigration(opts: WriteMigrationOptions): string[] {
  const absDir = path.resolve(opts.dir)
  fs.mkdirSync(absDir, { recursive: true })

  const prefix = generatePrefix(opts)
  const safeName = sanitizeName(opts.name)
  const written: string[] = []

  switch (opts.format) {
    case 'plain': {
      const filename = `${prefix}_${safeName}.sql`
      const content = `${opts.up.trim()}\n`
      const filePath = path.join(absDir, filename)
      fs.writeFileSync(filePath, content, 'utf-8')
      written.push(filePath)
      break
    }

    case 'goose': {
      const filename = `${prefix}_${safeName}.sql`
      let content = `-- +goose Up\n${opts.up.trim()}\n`
      if (opts.down) {
        content += `\n-- +goose Down\n${opts.down.trim()}\n`
      }
      const filePath = path.join(absDir, filename)
      fs.writeFileSync(filePath, content, 'utf-8')
      written.push(filePath)
      break
    }

    case 'golang-migrate': {
      const upFilename = `${prefix}_${safeName}.up.sql`
      const upPath = path.join(absDir, upFilename)
      fs.writeFileSync(upPath, `${opts.up.trim()}\n`, 'utf-8')
      written.push(upPath)

      if (opts.down) {
        const downFilename = `${prefix}_${safeName}.down.sql`
        const downPath = path.join(absDir, downFilename)
        fs.writeFileSync(downPath, `${opts.down.trim()}\n`, 'utf-8')
        written.push(downPath)
      }
      break
    }

    case 'flyway': {
      const version = prefix
      const upFilename = `V${version}__${safeName}.sql`
      const upPath = path.join(absDir, upFilename)
      fs.writeFileSync(upPath, `${opts.up.trim()}\n`, 'utf-8')
      written.push(upPath)

      if (opts.down) {
        const downFilename = `U${version}__${safeName}.sql`
        const downPath = path.join(absDir, downFilename)
        fs.writeFileSync(downPath, `${opts.down.trim()}\n`, 'utf-8')
        written.push(downPath)
      }
      break
    }

    case 'dbmate': {
      const filename = `${prefix}_${safeName}.sql`
      let content = `-- migrate:up\n${opts.up.trim()}\n`
      if (opts.down) {
        content += `\n-- migrate:down\n${opts.down.trim()}\n`
      }
      const filePath = path.join(absDir, filename)
      fs.writeFileSync(filePath, content, 'utf-8')
      written.push(filePath)
      break
    }
  }

  return written
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Generate a filename prefix based on naming strategy */
function generatePrefix(opts: WriteMigrationOptions): string {
  if (opts.naming === 'sequential') {
    return nextSequentialPrefix(opts.existing ?? [], opts.format)
  }
  return timestampPrefix()
}

/** Generate a YYYYMMDDHHMMSS timestamp prefix */
function timestampPrefix(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
}

/** Generate the next sequential prefix based on existing migrations */
function nextSequentialPrefix(existing: ParsedMigration[], format: MigrationFormat): string {
  if (format === 'flyway') {
    // Flyway uses V1, V2, etc. Extract the max version number.
    let max = 0
    for (const m of existing) {
      const match = m.filename.match(/^V(\d+)/)
      if (match) {
        const n = Number.parseInt(match[1], 10)
        if (n > max) max = n
      }
    }
    return String(max + 1)
  }

  // For other formats, find the highest numeric prefix and increment
  let max = 0
  for (const m of existing) {
    const match = m.sortKey.match(/^(\d+)/)
    if (match) {
      const n = Number.parseInt(match[1], 10)
      if (n > max) max = n
    }
  }
  return String(max + 1).padStart(3, '0')
}

/** Sanitize a migration name for use in filenames */
export function sanitizeName(name: string): string {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return safe || 'migration'
}

/**
 * Extract all up scripts from parsed migrations and concatenate them.
 * This gives the "current" schema state from migrations.
 */
export function concatUpScripts(migrations: ParsedMigration[]): string {
  return migrations
    .map((m) => m.up)
    .filter(Boolean)
    .join('\n\n')
}
