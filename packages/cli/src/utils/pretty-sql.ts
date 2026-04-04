/**
 * Pretty-format SQL migration statements while preserving function/procedure/trigger
 * bodies that are stored verbatim by the database engine.
 *
 * pg_get_functiondef() and MySQL's SHOW CREATE FUNCTION preserve original body
 * formatting. Reformatting these would create permanent diffs on every migrate run.
 */
import { format as formatSql } from '@sqltools/formatter'

/** Statements whose bodies are compared by Atlas as raw strings. */
const BODY_DIFFED_RE = /^\s*CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER)\b/i

const FMT_OPTS = { language: 'sql' as const, indent: '  ', linesBetweenQueries: 'preserve' as const }

/**
 * Join SQL statements into formatted text. When `pretty` is true,
 * statements that are safe to reformat get pretty-printed while
 * functions/procedures/triggers are left as-is.
 */
export function prettyStatements(stmts: string[], pretty?: boolean): string {
  if (!pretty) {
    return stmts.map((s) => `${s};`).join('\n\n')
  }
  return stmts
    .map((s) => {
      const sql = `${s};`
      if (BODY_DIFFED_RE.test(sql)) return sql
      return formatSql(sql, FMT_OPTS)
    })
    .join('\n\n')
}
