// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/internal/sqlx/dev.go

import type { ExecQuerier } from '../schema/inspect.ts'
import type { Inspector } from '../schema/inspect.ts'
import type { Realm } from '../schema/schema.ts'

/** Options for the dev database snapshot. */
export interface SnapshotOptions {
  /** Whether to clean (drop all objects) from the dev database after inspection. */
  clean?: boolean
  /** Schema name to inspect. If empty, inspects the default/attached schema. */
  schema?: string
  /** SQL dialect for quoting. */
  dialect?: 'postgres' | 'mysql' | 'sqlite'
}

/**
 * Capture a schema snapshot from a dev database.
 * Executes SQL files against the dev DB, then inspects the resulting schema.
 *
 * This is used to normalize user-provided SQL into its canonical form:
 * 1. Execute each SQL file's statements against the dev database
 * 2. Inspect the resulting schema via the Inspector
 * 3. Optionally clean (drop all objects) after inspection
 * 4. Return the captured Realm
 *
 * Security: Only executes against dev databases (pglite/sqlite), never production.
 */
export async function snapshot(
  db: ExecQuerier,
  inspector: Inspector,
  files: string[],
  opts?: SnapshotOptions,
): Promise<Realm> {
  // Execute each SQL file's statements against the dev database
  for (const sql of files) {
    if (sql.trim() === '') continue
    // Split on semicolons for basic statement separation.
    // Dialect-specific drivers may override with more sophisticated parsing.
    const statements = splitStatements(sql)
    for (const stmt of statements) {
      if (stmt.trim() === '') continue
      await db.exec(stmt)
    }
  }

  // Inspect the resulting schema
  const realm = await inspector.inspectRealm(opts?.schema ? { schemas: [opts.schema] } : undefined)

  // Optionally clean the dev database
  if (opts?.clean) {
    await cleanDevDatabase(db, realm, opts?.dialect)
  }

  return realm
}

/**
 * Execute SQL and inspect the resulting schema in one operation.
 * Convenience wrapper around snapshot for a single SQL string.
 */
export async function execAndInspect(
  db: ExecQuerier,
  inspector: Inspector,
  sql: string,
  opts?: SnapshotOptions,
): Promise<Realm> {
  return snapshot(db, inspector, [sql], opts)
}

/**
 * Clean a dev database by dropping all objects in reverse dependency order.
 * Drops tables, views, functions, sequences, etc.
 */
async function cleanDevDatabase(db: ExecQuerier, realm: Realm, dialect?: string): Promise<void> {
  const isSqlite = dialect === 'sqlite' || realm.schemas.some((s) => s.name === 'main')
  const isMySQL = dialect === 'mysql'
  const q = isMySQL ? (s: string) => `\`${s}\`` : (s: string) => `"${s}"`
  const cascade = isSqlite || isMySQL ? '' : ' CASCADE'

  for (const schema of realm.schemas) {
    const prefix = !isSqlite && schema.name ? `${q(schema.name)}.` : ''

    // Drop views first (may depend on tables)
    for (const v of schema.views ?? []) {
      const kind = v.materialized ? 'MATERIALIZED VIEW' : 'VIEW'
      await db.exec(`DROP ${kind} IF EXISTS ${prefix}${q(v.name)}${cascade}`)
    }

    // Disable FK checks before dropping tables (SQLite uses PRAGMA, MySQL uses SET)
    if (isSqlite && (schema.tables ?? []).length > 0) {
      await db.exec('PRAGMA foreign_keys = OFF')
    }
    if (isMySQL && (schema.tables ?? []).length > 0) {
      await db.exec('SET FOREIGN_KEY_CHECKS = 0')
    }
    for (const t of schema.tables ?? []) {
      await db.exec(`DROP TABLE IF EXISTS ${prefix}${q(t.name)}${cascade}`)
    }
    if (isSqlite && (schema.tables ?? []).length > 0) {
      await db.exec('PRAGMA foreign_keys = ON')
    }
    if (isMySQL && (schema.tables ?? []).length > 0) {
      await db.exec('SET FOREIGN_KEY_CHECKS = 1')
    }

    // Drop functions/procedures/sequences (not supported in SQLite)
    if (!isSqlite) {
      for (const f of schema.funcs ?? []) {
        await db.exec(`DROP FUNCTION IF EXISTS ${prefix}${q(f.name)}${cascade}`)
      }
      for (const p of schema.procs ?? []) {
        await db.exec(`DROP PROCEDURE IF EXISTS ${prefix}${q(p.name)}${cascade}`)
      }
      if (!isMySQL) {
        for (const s of schema.sequences ?? []) {
          await db.exec(`DROP SEQUENCE IF EXISTS ${prefix}${q(s.name)}${cascade}`)
        }
      }
    }
  }
}

/**
 * Split a SQL string into individual statements by semicolons.
 * Respects string literals and avoids splitting within them.
 */
function splitStatements(sql: string): string[] {
  const stmts: string[] = []
  let current = ''
  let inString = false
  let stringChar = ''
  let inDollarQuote = false
  let dollarTag = ''

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]

    // Handle dollar-quoted strings (PostgreSQL)
    if (!inString && ch === '$') {
      const tagEnd = sql.indexOf('$', i + 1)
      if (tagEnd !== -1) {
        const tag = sql.slice(i, tagEnd + 1)
        if (inDollarQuote && tag === dollarTag) {
          current += tag
          i = tagEnd
          inDollarQuote = false
          dollarTag = ''
          continue
        } else if (!inDollarQuote) {
          inDollarQuote = true
          dollarTag = tag
          current += tag
          i = tagEnd
          continue
        }
      }
    }

    if (inDollarQuote) {
      current += ch
      continue
    }

    // Handle regular string literals
    if (!inString && (ch === "'" || ch === '"')) {
      inString = true
      stringChar = ch
      current += ch
      continue
    }

    if (inString) {
      current += ch
      if (ch === stringChar) {
        // Check for escaped quote
        if (i + 1 < sql.length && sql[i + 1] === stringChar) {
          current += sql[i + 1]
          i++
        } else {
          inString = false
        }
      }
      continue
    }

    // Handle line comments
    if (ch === '-' && i + 1 < sql.length && sql[i + 1] === '-') {
      const lineEnd = sql.indexOf('\n', i)
      if (lineEnd === -1) {
        current += sql.slice(i)
        i = sql.length
      } else {
        current += sql.slice(i, lineEnd + 1)
        i = lineEnd
      }
      continue
    }

    // Handle block comments
    if (ch === '/' && i + 1 < sql.length && sql[i + 1] === '*') {
      const commentEnd = sql.indexOf('*/', i + 2)
      if (commentEnd === -1) {
        current += sql.slice(i)
        i = sql.length
      } else {
        current += sql.slice(i, commentEnd + 2)
        i = commentEnd + 1
      }
      continue
    }

    // Statement separator
    if (ch === ';') {
      const trimmed = current.trim()
      if (trimmed) {
        stmts.push(trimmed)
      }
      current = ''
      continue
    }

    current += ch
  }

  // Add any remaining statement
  const trimmed = current.trim()
  if (trimmed) {
    stmts.push(trimmed)
  }

  return stmts
}
