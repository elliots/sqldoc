/**
 * Detect destructive schema changes from structured diff output.
 *
 * Only changes that destroy stored data are considered destructive:
 * - drop_table (rows deleted)
 * - drop_column (column data deleted)
 *
 * Views, functions, indexes are not destructive — they don't hold data.
 */
import type { Change } from '@sqldoc/db'

/**
 * Filter an array of schema changes to only destructive ones.
 * Recurses into modify_table and modify_schema to find nested drops.
 */
export function detectDestructiveChanges(changes: Change[]): Change[] {
  const result: Change[] = []
  for (const c of changes) {
    switch (c.type) {
      case 'drop_table':
      case 'drop_column':
        result.push(c)
        break
      case 'modify_table':
        result.push(...detectDestructiveChanges(c.changes))
        break
      case 'modify_schema':
        result.push(...detectDestructiveChanges(c.changes))
        break
    }
  }
  return result
}
