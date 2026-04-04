/**
 * Detect destructive schema changes from Atlas structured diff output.
 *
 * Only changes that destroy stored data are considered destructive:
 * - drop_table (rows deleted)
 * - drop_column (column data deleted)
 *
 * Views, functions, indexes are not destructive — they don't hold data.
 */
import type { AtlasChange } from '@sqldoc/db'

const DESTRUCTIVE_TYPES = new Set(['drop_table', 'drop_column'])

/**
 * Filter an array of structured Atlas changes to only destructive ones.
 */
export function detectDestructiveChanges(changes: AtlasChange[]): AtlasChange[] {
  return changes.filter((c) => DESTRUCTIVE_TYPES.has(c.type))
}
