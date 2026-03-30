import type { AtlasChange } from '@sqldoc/db'
import { describe, expect, it } from '@sqldoc/test-utils'
import { renderChanges } from '../utils/pretty-changes.ts'

// Strip ANSI escape sequences for assertion
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

describe('renderChanges', () => {
  it('returns empty array for no changes', () => {
    expect(renderChanges([])).toEqual([])
  })

  it('renders add_table', () => {
    const changes: AtlasChange[] = [{ type: 'add_table', table: 'users' }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  + users (new table)')
  })

  it('renders drop_table', () => {
    const changes: AtlasChange[] = [{ type: 'drop_table', table: 'old_logs' }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  - old_logs (dropped)')
  })

  it('renders rename_table', () => {
    const changes: AtlasChange[] = [{ type: 'rename_table', table: 'accounts', detail: 'users -> accounts' }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  ~ accounts (renamed from users)')
  })

  it('renders add_view', () => {
    const changes: AtlasChange[] = [{ type: 'add_view', table: 'active_posts' }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  + active_posts (view)')
  })

  it('renders drop_view', () => {
    const changes: AtlasChange[] = [{ type: 'drop_view', table: 'old_view' }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  - old_view (view dropped)')
  })

  it('renders add_function', () => {
    const changes: AtlasChange[] = [{ type: 'add_function', table: 'calculate_total' }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  + calculate_total (function)')
  })

  it('renders drop_function', () => {
    const changes: AtlasChange[] = [{ type: 'drop_function', table: 'old_func' }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  - old_func (function dropped)')
  })

  it('renders column changes nested under table', () => {
    const changes: AtlasChange[] = [
      { type: 'add_column', table: 'users', name: 'age', detail: 'integer' },
      { type: 'drop_column', table: 'users', name: 'legacy_id' },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('  users') // table header
    expect(lines[1]).toBe('    + age (integer)')
    expect(lines[2]).toBe('    - legacy_id')
  })

  it('renders rename_column', () => {
    const changes: AtlasChange[] = [
      { type: 'rename_column', table: 'users', name: 'email_address', detail: 'email -> email_address' },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2) // table header + change
    expect(lines[1]).toBe('    ~ email -> email_address (renamed)')
  })

  it('renders modify_column', () => {
    const changes: AtlasChange[] = [
      { type: 'modify_column', table: 'users', name: 'email', detail: 'varchar(100) -> varchar(255)' },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2) // table header + change
    expect(lines[1]).toBe('    ~ email (varchar(100) -> varchar(255))')
  })

  it('renders add_index nested under table', () => {
    const changes: AtlasChange[] = [{ type: 'add_index', table: 'users', name: 'idx_users_email' }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('    + idx_users_email (index)')
  })

  it('renders drop_index nested under table', () => {
    const changes: AtlasChange[] = [{ type: 'drop_index', table: 'users', name: 'idx_old' }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('    - idx_old (index)')
  })

  it('nests sub-changes under table-level change', () => {
    const changes: AtlasChange[] = [
      { type: 'add_table', table: 'users' },
      { type: 'add_column', table: 'users', name: 'id', detail: 'bigint' },
      { type: 'add_column', table: 'users', name: 'email', detail: 'text' },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('  + users (new table)')
    expect(lines[1]).toBe('    + id (bigint)')
    expect(lines[2]).toBe('    + email (text)')
  })

  it('renders mixed table-level and column changes', () => {
    const changes: AtlasChange[] = [
      { type: 'add_table', table: 'posts' },
      { type: 'rename_table', table: 'accounts', detail: 'users -> accounts' },
      { type: 'add_column', table: 'accounts', name: 'age', detail: 'integer' },
      { type: 'drop_column', table: 'orders', name: 'legacy_id' },
      { type: 'drop_table', table: 'old_logs' },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(6)
    expect(lines[0]).toBe('  + posts (new table)')
    expect(lines[1]).toBe('  ~ accounts (renamed from users)')
    expect(lines[2]).toBe('    + age (integer)')
    expect(lines[3]).toBe('  - old_logs (dropped)')
    expect(lines[4]).toBe('  orders') // table header for sub-changes
    expect(lines[5]).toBe('    - legacy_id')
  })

  it('handles add_column without detail', () => {
    const changes: AtlasChange[] = [{ type: 'add_column', table: 'users', name: 'status' }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('    + status')
  })

  it('handles modify_column without detail', () => {
    const changes: AtlasChange[] = [{ type: 'modify_column', table: 'users', name: 'email' }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('    ~ email')
  })
})
