// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/schema/exclude_oss.go

import type { Realm, Schema, Table, View } from './schema.ts'

// -- Pattern Matching --

/**
 * Matches a name against a glob pattern.
 * Supports `*` (match any sequence) and `?` (match any single char).
 */
export function matchPattern(name: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regex = '^'
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') {
      regex += '.*'
    } else if (ch === '?') {
      regex += '.'
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      regex += `\\${ch}`
    } else {
      regex += ch
    }
  }
  regex += '$'
  return new RegExp(regex).test(name)
}

// -- Type Selectors --

const reType = /\[type=([a-z|_]+)+\]$/

/**
 * Extracts a type selector from a pattern element.
 * e.g. "foo[type=table]" -> { glob: "foo", exclude: true }
 * e.g. "foo[type=view]" when checking for table -> { glob: "foo", exclude: false }
 * e.g. "foo" (no selector) -> { glob: "foo", exclude: true }
 */
function excludeType(typeName: string, value: string): { glob: string; exclude: boolean } {
  const matches = reType.exec(value)
  if (!matches || matches.length !== 2) {
    return { glob: value, exclude: true }
  }
  const glob = value.slice(0, -matches[0].length)
  const types = matches[1].split('|')
  return { glob, exclude: types.includes(typeName) }
}

// -- Split Patterns --

/**
 * Splits dot-separated patterns into chains.
 * e.g. "public.users.id" -> ["public", "users", "id"]
 * Respects quoted segments (e.g. `"my.table"` stays as one segment).
 */
function splitPatterns(patterns: string[]): string[][] {
  const result: string[][] = []
  for (const pattern of patterns) {
    const parts: string[] = []
    let current = ''
    let inQuote = false
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i]
      if (ch === '"') {
        inQuote = !inQuote
      } else if (ch === '.' && !inQuote) {
        parts.push(current)
        current = ''
      } else {
        current += ch
      }
    }
    if (inQuote) {
      throw new Error(`unclosed quote in pattern: "${pattern}"`)
    }
    if (current.length > 0) {
      parts.push(current)
    }
    if (parts.length === 0 || parts.some((p) => p === '')) {
      throw new Error(`empty segment in pattern: "${pattern}"`)
    }
    result.push(parts)
  }
  return result
}

// -- Exclude Table Internals --

function excludeTable(table: Table, pattern: string): void {
  const col = excludeType('column', pattern)
  if (col.exclude) {
    table.columns = table.columns.filter((c) => !matchPattern(c.name, col.glob))
  }

  const idx = excludeType('index', pattern)
  if (idx.exclude && table.indexes) {
    table.indexes = table.indexes.filter((i) => !i.name || !matchPattern(i.name, idx.glob))
  }

  const fk = excludeType('fk', pattern)
  if (fk.exclude && table.foreignKeys) {
    table.foreignKeys = table.foreignKeys.filter((f) => !f.symbol || !matchPattern(f.symbol, fk.glob))
  }

  const tg = excludeType('trigger', pattern)
  if (tg.exclude && table.triggers) {
    table.triggers = table.triggers.filter((t) => !matchPattern(t.name, tg.glob))
  }

  const ck = excludeType('check', pattern)
  if (ck.exclude && table.checks) {
    table.checks = table.checks.filter((c) => !c.name || !matchPattern(c.name, ck.glob))
  }
}

// -- Exclude View Internals --

function excludeView(view: View, pattern: string): void {
  const col = excludeType('column', pattern)
  if (col.exclude && view.columns) {
    view.columns = view.columns.filter((c) => !matchPattern(c.name, col.glob))
  }

  const tg = excludeType('trigger', pattern)
  if (tg.exclude) {
    // Views may have triggers in some dialects
  }
}

// -- Exclude Schema --

function excludeSchemaObjects(schema: Schema, glob: string[]): void {
  const tbl = excludeType('table', glob[0])
  if (tbl.exclude && schema.tables) {
    schema.tables = schema.tables.filter((t) => {
      if (!matchPattern(t.name, tbl.glob)) return true
      if (glob.length === 1) return false // exclude the whole table
      excludeTable(t, glob[1])
      return true
    })
  }

  const vw = excludeType('view', glob[0])
  if (vw.exclude && schema.views) {
    schema.views = schema.views.filter((v) => {
      if (!matchPattern(v.name, vw.glob)) return true
      if (glob.length === 1) return false
      excludeView(v, glob[1])
      return true
    })
  }

  if (glob.length === 1) {
    const fn = excludeType('function', glob[0])
    if (fn.exclude && schema.funcs) {
      schema.funcs = schema.funcs.filter((f) => !matchPattern(f.name, fn.glob))
    }

    const pr = excludeType('procedure', glob[0])
    if (pr.exclude && schema.procs) {
      schema.procs = schema.procs.filter((p) => !matchPattern(p.name, pr.glob))
    }
  }
}

// -- Public API --

/**
 * Filters resources in the realm based on the given exclusion patterns.
 * Pattern format: `schema.table.column` (dot-separated, glob-aware).
 *
 * Examples:
 * - `"public"` - exclude schema "public"
 * - `"*"` - exclude all schemas
 * - `"public.users"` - exclude table "users" from schema "public"
 * - `"public.*"` - exclude all tables from schema "public"
 * - `"*.users"` - exclude table "users" from all schemas
 * - `"public.users.id"` - exclude column "id" from table "users" in "public"
 *
 * Mutates the realm in place and returns it.
 */
export function excludeRealm(realm: Realm, patterns: string[]): Realm {
  if (patterns.length === 0) return realm

  const globs = splitPatterns(patterns)

  for (const glob of globs) {
    if (glob.length > 3) {
      throw new Error(`too many parts in pattern: "${glob.join('.')}"`)
    }
  }

  realm.schemas = realm.schemas.filter((schema) => {
    for (const glob of globs) {
      const s = excludeType('schema', glob[0])
      if (!s.exclude) continue
      if (!matchPattern(schema.name, s.glob)) continue

      // Single-part pattern: exclude the whole schema
      if (glob.length === 1) return false

      // Multi-part pattern: filter within the schema
      excludeSchemaObjects(schema, glob.slice(1))
    }
    return true
  })

  return realm
}

/**
 * Filters resources in a schema based on exclusion patterns.
 * Patterns are relative to the schema (no schema prefix needed).
 *
 * Examples:
 * - `"users"` - exclude table "users"
 * - `"*"` - exclude all tables
 * - `"users.id"` - exclude column "id" from table "users"
 */
export function excludeSchema(schema: Schema, patterns: string[]): Schema {
  if (patterns.length === 0) return schema
  const globs = splitPatterns(patterns)
  for (const glob of globs) {
    if (glob.length > 2) {
      throw new Error(`schema exclude pattern has too many parts (max 2): "${glob.join('.')}"`)
    }
    excludeSchemaObjects(schema, glob)
  }
  return schema
}
