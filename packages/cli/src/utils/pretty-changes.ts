import type { AtlasChange } from '@sqldoc/atlas'
import pc from 'picocolors'

/**
 * Render structured schema changes with colors and grouping.
 *
 * Table-level changes (add/drop/rename table/view/function) get their own line.
 * Column/index changes are nested under their parent table.
 *
 * Color coding:
 * - Green (+) for additions
 * - Red (-) for drops (destructive)
 * - Yellow (~) for modifications/renames
 */
export function renderChanges(changes: AtlasChange[]): string[] {
  if (changes.length === 0) return []

  // Separate table-level changes from sub-changes
  const tableLevelTypes = new Set([
    'add_table',
    'drop_table',
    'rename_table',
    'add_view',
    'drop_view',
    'add_function',
    'drop_function',
  ])

  const tableLevel: AtlasChange[] = []
  const subChanges: AtlasChange[] = []

  for (const c of changes) {
    if (tableLevelTypes.has(c.type)) {
      tableLevel.push(c)
    } else {
      subChanges.push(c)
    }
  }

  // Group sub-changes by table
  const byTable = new Map<string, AtlasChange[]>()
  for (const c of subChanges) {
    const existing = byTable.get(c.table) ?? []
    existing.push(c)
    byTable.set(c.table, existing)
  }

  // Tables that have table-level changes (so we don't print a header for them)
  const tableLevelNames = new Set(tableLevel.map((c) => c.table))

  const lines: string[] = []

  // Render table-level changes first
  for (const c of tableLevel) {
    lines.push(formatTableChange(c))

    // If this table also has sub-changes, render them nested
    const nested = byTable.get(c.table)
    if (nested) {
      for (const sc of nested) {
        lines.push(formatSubChange(sc))
      }
      byTable.delete(c.table)
    }
  }

  // Render remaining sub-changes grouped by table
  for (const [table, tChanges] of byTable) {
    if (!tableLevelNames.has(table)) {
      lines.push(pc.dim(`  ${table}`))
    }
    for (const sc of tChanges) {
      lines.push(formatSubChange(sc))
    }
  }

  return lines
}

/**
 * Print rendered changes to stderr.
 */
export function printChanges(changes: AtlasChange[], header?: string): void {
  const lines = renderChanges(changes)
  if (lines.length === 0) return

  if (header) {
    console.error(header)
    console.error('')
  }
  for (const line of lines) {
    console.error(line)
  }
  console.error('')
}

function formatTableChange(c: AtlasChange): string {
  switch (c.type) {
    case 'add_table':
      return pc.green(`  + ${c.table} (new table)`)
    case 'drop_table':
      return pc.red(`  - ${c.table} (dropped)`)
    case 'rename_table':
      return pc.yellow(`  ~ ${c.table} (renamed from ${oldName(c.detail)})`)
    case 'add_view':
      return pc.green(`  + ${c.table} (view)`)
    case 'drop_view':
      return pc.red(`  - ${c.table} (view dropped)`)
    case 'add_function':
      return pc.green(`  + ${c.table} (function)`)
    case 'drop_function':
      return pc.red(`  - ${c.table} (function dropped)`)
    default:
      return `  ${c.table}`
  }
}

function formatSubChange(c: AtlasChange): string {
  switch (c.type) {
    case 'add_column': {
      const detail = c.detail ? ` (${c.detail})` : ''
      return pc.green(`    + ${c.name}${detail}`)
    }
    case 'drop_column':
      return pc.red(`    - ${c.name}`)
    case 'rename_column':
      return pc.yellow(`    ~ ${oldName(c.detail)} -> ${c.name} (renamed)`)
    case 'modify_column': {
      const detail = c.detail ? ` (${c.detail})` : ''
      return pc.yellow(`    ~ ${c.name}${detail}`)
    }
    case 'add_index':
      return pc.green(`    + ${c.name} (index)`)
    case 'drop_index':
      return pc.red(`    - ${c.name} (index)`)
    default:
      return `    ${c.name ?? c.type}`
  }
}

/**
 * Extract the old name from a "old -> new" detail string.
 */
function oldName(detail?: string): string {
  if (!detail) return '?'
  const arrow = detail.indexOf(' -> ')
  if (arrow === -1) return detail
  return detail.substring(0, arrow)
}
