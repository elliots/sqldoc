import type { Change } from '@sqldoc/db'
import pc from 'picocolors'

/**
 * Render schema changes with colors and grouping.
 *
 * Table-level changes (add/drop/rename table/view/function) get their own line.
 * Column/index changes are nested under their parent table.
 */
export function renderChanges(changes: Change[]): string[] {
  if (changes.length === 0) return []
  const lines: string[] = []

  for (const c of changes) {
    switch (c.type) {
      case 'add_table':
        lines.push(pc.green(`  + ${c.T.name} (new table)`))
        for (const idx of c.T.indexes ?? []) {
          lines.push(pc.green(`    + ${idx.name ?? 'unnamed'} (index)`))
        }
        break
      case 'drop_table':
        lines.push(pc.red(`  - ${c.T.name} (dropped)`))
        break
      case 'rename_table':
        lines.push(pc.yellow(`  ~ ${c.to.name} (renamed from ${c.from.name})`))
        break
      case 'modify_table':
        lines.push(pc.dim(`  ${c.T.name}`))
        for (const sub of c.changes) {
          lines.push(formatSubChange(sub))
        }
        break
      case 'add_view':
        lines.push(pc.green(`  + ${c.V.name} (view)`))
        break
      case 'drop_view':
        lines.push(pc.red(`  - ${c.V.name} (view dropped)`))
        break
      case 'modify_view':
        lines.push(pc.yellow(`  ~ ${c.to.name} (view modified)`))
        break
      case 'add_func':
        lines.push(pc.green(`  + ${c.F.name} (function)`))
        break
      case 'drop_func':
        lines.push(pc.red(`  - ${c.F.name} (function dropped)`))
        break
      case 'modify_func':
        lines.push(pc.yellow(`  ~ ${c.to.name} (function modified)`))
        break
      case 'modify_schema':
        lines.push(...renderChanges(c.changes))
        break
    }
  }

  return lines
}

function formatSubChange(c: Change): string {
  switch (c.type) {
    case 'add_column': {
      const detail = c.C.type?.type?.T ? ` (${c.C.type.type.T})` : ''
      return pc.green(`    + ${c.C.name}${detail}`)
    }
    case 'drop_column':
      return pc.red(`    - ${c.C.name}`)
    case 'rename_column':
      return pc.yellow(`    ~ ${c.from.name} -> ${c.to.name} (renamed)`)
    case 'modify_column': {
      const parts: string[] = []
      if (c.from.type?.type?.T !== c.to.type?.type?.T) {
        parts.push(`${c.from.type?.type?.T ?? ''} -> ${c.to.type?.type?.T ?? ''}`)
      }
      if (c.from.type?.null !== c.to.type?.null) {
        parts.push(c.to.type?.null ? 'set nullable' : 'set not null')
      }
      const detail = parts.length > 0 ? ` (${parts.join(', ')})` : ''
      return pc.yellow(`    ~ ${c.to.name}${detail}`)
    }
    case 'add_index':
      return pc.green(`    + ${c.I.name ?? 'unnamed'} (index)`)
    case 'drop_index':
      return pc.red(`    - ${c.I.name ?? 'unnamed'} (index)`)
    default:
      return `    ${c.type}`
  }
}

/**
 * Print rendered changes to stderr.
 */
export function printChanges(changes: Change[], header?: string): void {
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
