// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/sqltool/tool.go

import type { File } from '../migrate/dir.ts'

// -- Types --

/** A formatter that produces migration file content from a plan. */
export interface Formatter {
  /** Generate migration file content from changes. */
  format(plan: FormatterInput): FormattedFile[]
}

/** Input to a formatter. */
export interface FormatterInput {
  /** Optional migration name (used in filename and annotations). */
  name?: string
  /** The list of changes to format. */
  changes: FormatterChange[]
}

/** A single change to format. */
export interface FormatterChange {
  /** The SQL command. */
  cmd: string
  /** Human-readable comment. */
  comment?: string
  /** Reverse SQL statements for rollback. */
  reverseStmts?: string[]
}

/** A formatted migration file with name and content. */
export interface FormattedFile {
  /** The file name. */
  name: string
  /** The file content. */
  content: string
}

/** A parsed migration file from a directory scan. */
export interface MigrationFile {
  /** The file name. */
  name: string
  /** The version extracted from the filename. */
  version: string
  /** The description extracted from the filename. */
  description?: string
  /** The raw file content. */
  content: string
}

// -- Helpers --

/** Generate a timestamp string in YYYYMMDDHHMMSS format. */
export function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  )
}

/** Reverse an array (non-mutating). */
function reverse<T>(arr: T[]): T[] {
  return [...arr].reverse()
}

/** Check if a file is hidden (starts with dot). */
export function isHidden(name: string): boolean {
  return name.startsWith('.')
}

// -- Formatters --

/** Formatter compatible with golang-migrate/migrate. */
export const golangMigrateFormatter: Formatter = {
  format(plan: FormatterInput): FormattedFile[] {
    const ts = now()
    const suffix = plan.name ? `_${plan.name}` : ''
    const files: FormattedFile[] = []

    // Up file
    let up = ''
    for (const c of plan.changes) {
      if (c.comment) up += `-- ${c.comment}\n`
      up += `${c.cmd};\n`
    }
    files.push({ name: `${ts}${suffix}.up.sql`, content: up })

    // Down file
    let down = ''
    for (const c of reverse(plan.changes)) {
      if (c.reverseStmts && c.reverseStmts.length > 0) {
        if (c.comment) down += `-- reverse: ${c.comment}\n`
        for (const s of c.reverseStmts) {
          down += `${s};\n`
        }
      }
    }
    if (down) {
      files.push({ name: `${ts}${suffix}.down.sql`, content: down })
    }

    return files
  },
}

/** Formatter compatible with pressly/goose. */
export const gooseFormatter: Formatter = {
  format(plan: FormatterInput): FormattedFile[] {
    const ts = now()
    const suffix = plan.name ? `_${plan.name}` : ''

    let content = '-- +goose Up\n'
    for (const c of plan.changes) {
      if (c.comment) content += `-- ${c.comment}\n`
      content += `${c.cmd};\n`
    }
    content += '\n-- +goose Down\n'
    for (const c of reverse(plan.changes)) {
      if (c.reverseStmts && c.reverseStmts.length > 0) {
        if (c.comment) content += `-- reverse: ${c.comment}\n`
        for (const s of c.reverseStmts) {
          content += `${s};\n`
        }
      }
    }

    return [{ name: `${ts}${suffix}.sql`, content }]
  },
}

/** Formatter compatible with Flyway. */
export const flywayFormatter: Formatter = {
  format(plan: FormatterInput): FormattedFile[] {
    const ts = now()
    const suffix = plan.name ? `__${plan.name}` : ''
    const files: FormattedFile[] = []

    // Versioned migration (V prefix)
    let up = ''
    for (const c of plan.changes) {
      if (c.comment) up += `-- ${c.comment}\n`
      up += `${c.cmd};\n`
    }
    files.push({ name: `V${ts}${suffix}.sql`, content: up })

    // Undo migration (U prefix)
    let down = ''
    for (const c of reverse(plan.changes)) {
      if (c.reverseStmts && c.reverseStmts.length > 0) {
        if (c.comment) down += `-- reverse: ${c.comment}\n`
        for (const s of c.reverseStmts) {
          down += `${s};\n`
        }
      }
    }
    if (down) {
      files.push({ name: `U${ts}${suffix}.sql`, content: down })
    }

    return files
  },
}

/** Formatter compatible with Liquibase. */
export const liquibaseFormatter: Formatter = {
  format(plan: FormatterInput): FormattedFile[] {
    const ts = now()
    const suffix = plan.name ? `_${plan.name}` : ''

    let content = '--liquibase formatted sql\n'
    for (let i = 0; i < plan.changes.length; i++) {
      const c = plan.changes[i]
      content += `\n--changeset sqldoc:${ts}-${i + 1}\n`
      if (c.comment) content += `--comment: ${c.comment}\n`
      content += `${c.cmd};\n`
      if (c.reverseStmts && c.reverseStmts.length > 0) {
        for (const s of c.reverseStmts) {
          content += `--rollback: ${s};\n`
        }
      }
    }

    return [{ name: `${ts}${suffix}.sql`, content }]
  },
}

/** Formatter compatible with amacneil/dbmate. */
export const dbmateFormatter: Formatter = {
  format(plan: FormatterInput): FormattedFile[] {
    const ts = now()
    const suffix = plan.name ? `_${plan.name}` : ''

    let content = '-- migrate:up\n'
    for (const c of plan.changes) {
      if (c.comment) content += `-- ${c.comment}\n`
      content += `${c.cmd};\n`
    }
    content += '\n-- migrate:down\n'
    for (const c of reverse(plan.changes)) {
      if (c.reverseStmts && c.reverseStmts.length > 0) {
        if (c.comment) content += `-- reverse: ${c.comment}\n`
        for (const s of c.reverseStmts) {
          content += `${s};\n`
        }
      }
    }

    return [{ name: `${ts}${suffix}.sql`, content }]
  },
}

// -- Directory Scanners --

// Filename patterns for each tool
const golangMigratePattern = /^(\d+)(?:_(.+?))?\.(?:up|down)\.sql$/
const goosePattern = /^(\d+)(?:_(.+?))?\.sql$/
const flywayPrefix = /^[VU]/
const liquibasePattern = /^(\d+)(?:_(.+?))?\.sql$/
const dbmatePattern = /^(\d+)(?:_(.+?))?\.sql$/

/** Scan a directory for golang-migrate format files (*.up.sql only). */
export function scanGolangMigrateDir(files: File[]): MigrationFile[] {
  const results: MigrationFile[] = []
  for (const f of files) {
    if (isHidden(f.name)) continue
    // Only include .up.sql files
    if (!f.name.endsWith('.up.sql')) continue
    const m = golangMigratePattern.exec(f.name)
    if (!m) continue
    results.push({
      name: f.name,
      version: m[1],
      description: m[2]?.replace(/\.up$/, ''),
      content: f.content,
    })
  }
  results.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
  return results
}

/** Scan a directory for goose format files. */
export function scanGooseDir(files: File[]): MigrationFile[] {
  const results: MigrationFile[] = []
  for (const f of files) {
    if (isHidden(f.name)) continue
    const m = goosePattern.exec(f.name)
    if (!m) continue
    results.push({
      name: f.name,
      version: m[1],
      description: m[2],
      content: f.content,
    })
  }
  results.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
  return results
}

/** Scan a directory for flyway format files (V and B prefixed, plus R for repeatable). */
export function scanFlywayDir(files: File[]): MigrationFile[] {
  const results: MigrationFile[] = []
  for (const f of files) {
    if (isHidden(f.name)) continue
    if (!f.name.endsWith('.sql')) continue
    if (!flywayPrefix.test(f.name)) continue
    const base = f.name.replace(/\.sql$/, '')
    const version = flywayVersion(base)
    const description = flywayDesc(base)
    results.push({
      name: f.name,
      version,
      description: description || undefined,
      content: f.content,
    })
  }
  results.sort((a, b) => flywayVersionCompare(a.version, b.version))
  return results
}

/** Extract version from a flyway filename (without .sql extension). */
function flywayVersion(base: string): string {
  // Strip the prefix letter (V, U, B, R)
  const rest = base.slice(1)
  // Split on __ to separate version from description
  const parts = rest.split('__')
  return parts[0]
}

/** Extract description from a flyway filename (without .sql extension). */
function flywayDesc(base: string): string {
  const rest = base.slice(1)
  const parts = rest.split('__')
  if (parts.length < 2) return ''
  return parts.slice(1).join('__')
}

/** Compare flyway version strings numerically (supports semver-like: 1.2.3, 1_1_0). */
function flywayVersionCompare(v1: string, v2: string): number {
  const parse = (s: string): number[] =>
    s
      .replace(/_/g, '.')
      .split('.')
      .map((p) => {
        const n = parseInt(p, 10)
        return Number.isNaN(n) ? 0 : n
      })
  const a = parse(v1)
  const b = parse(v2)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x - y
  }
  return 0
}

/** Scan a directory for liquibase format files. */
export function scanLiquibaseDir(files: File[]): MigrationFile[] {
  const results: MigrationFile[] = []
  for (const f of files) {
    if (isHidden(f.name)) continue
    const m = liquibasePattern.exec(f.name)
    if (!m) continue
    results.push({
      name: f.name,
      version: m[1],
      description: m[2],
      content: f.content,
    })
  }
  results.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
  return results
}

/** Scan a directory for dbmate format files. */
export function scanDbmateDir(files: File[]): MigrationFile[] {
  const results: MigrationFile[] = []
  for (const f of files) {
    if (isHidden(f.name)) continue
    const m = dbmatePattern.exec(f.name)
    if (!m) continue
    results.push({
      name: f.name,
      version: m[1],
      description: m[2],
      content: f.content,
    })
  }
  results.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
  return results
}
