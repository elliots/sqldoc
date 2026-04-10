import type { Change } from '@sqldoc/db'
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
    const changes: Change[] = [{ type: 'add_table', T: { name: 'users', columns: [] } }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  + users (new table)')
  })

  it('renders drop_table', () => {
    const changes: Change[] = [{ type: 'drop_table', T: { name: 'old_logs', columns: [] } }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  - old_logs (dropped)')
  })

  it('renders rename_table', () => {
    const changes: Change[] = [
      { type: 'rename_table', from: { name: 'users', columns: [] }, to: { name: 'accounts', columns: [] } },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  ~ accounts (renamed from users)')
  })

  it('renders add_view', () => {
    const changes: Change[] = [{ type: 'add_view', V: { name: 'active_posts' } }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  + active_posts (view)')
  })

  it('renders drop_view', () => {
    const changes: Change[] = [{ type: 'drop_view', V: { name: 'old_view' } }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  - old_view (view dropped)')
  })

  it('renders add_func', () => {
    const changes: Change[] = [{ type: 'add_func', F: { name: 'calculate_total' } }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  + calculate_total (function)')
  })

  it('renders drop_func', () => {
    const changes: Change[] = [{ type: 'drop_func', F: { name: 'old_func' } }]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  - old_func (function dropped)')
  })

  it('renders column changes nested under modify_table', () => {
    const changes: Change[] = [
      {
        type: 'modify_table',
        T: { name: 'users', columns: [] },
        changes: [
          { type: 'add_column', C: { name: 'age', type: { type: { kind: 'integer', T: 'integer' } } } },
          { type: 'drop_column', C: { name: 'legacy_id', type: { type: { kind: 'integer', T: 'integer' } } } },
        ],
      },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('  users') // table header
    expect(lines[1]).toBe('    + age (integer)')
    expect(lines[2]).toBe('    - legacy_id')
  })

  it('renders rename_column', () => {
    const changes: Change[] = [
      {
        type: 'modify_table',
        T: { name: 'users', columns: [] },
        changes: [
          {
            type: 'rename_column',
            from: { name: 'email', type: { type: { kind: 'string', T: 'text' } } },
            to: { name: 'email_address', type: { type: { kind: 'string', T: 'text' } } },
          },
        ],
      },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2) // table header + change
    expect(lines[1]).toBe('    ~ email -> email_address (renamed)')
  })

  it('renders modify_column', () => {
    const changes: Change[] = [
      {
        type: 'modify_table',
        T: { name: 'users', columns: [] },
        changes: [
          {
            type: 'modify_column',
            from: { name: 'email', type: { type: { kind: 'string', T: 'varchar(100)' } } },
            to: { name: 'email', type: { type: { kind: 'string', T: 'varchar(255)' } } },
            change: 0,
          },
        ],
      },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2) // table header + change
    expect(lines[1]).toBe('    ~ email (varchar(100) -> varchar(255))')
  })

  it('renders add_index nested under modify_table', () => {
    const changes: Change[] = [
      {
        type: 'modify_table',
        T: { name: 'users', columns: [] },
        changes: [{ type: 'add_index', I: { name: 'idx_users_email', parts: [{ column: 'email' }] } }],
      },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('    + idx_users_email (index)')
  })

  it('renders drop_index nested under modify_table', () => {
    const changes: Change[] = [
      {
        type: 'modify_table',
        T: { name: 'users', columns: [] },
        changes: [{ type: 'drop_index', I: { name: 'idx_old', parts: [{ column: 'id' }] } }],
      },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('    - idx_old (index)')
  })

  it('renders add_table with nested column additions via add_table indexes', () => {
    const changes: Change[] = [
      {
        type: 'add_table',
        T: {
          name: 'users',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigint' } } },
            { name: 'email', type: { type: { kind: 'string', T: 'text' } } },
          ],
        },
      },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('  + users (new table)')
  })

  it('renders mixed table-level and modify_table changes', () => {
    const changes: Change[] = [
      { type: 'add_table', T: { name: 'posts', columns: [] } },
      {
        type: 'rename_table',
        from: { name: 'users', columns: [] },
        to: { name: 'accounts', columns: [] },
      },
      {
        type: 'modify_table',
        T: { name: 'accounts', columns: [] },
        changes: [{ type: 'add_column', C: { name: 'age', type: { type: { kind: 'integer', T: 'integer' } } } }],
      },
      { type: 'drop_table', T: { name: 'old_logs', columns: [] } },
      {
        type: 'modify_table',
        T: { name: 'orders', columns: [] },
        changes: [{ type: 'drop_column', C: { name: 'legacy_id', type: { type: { kind: 'integer', T: 'integer' } } } }],
      },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(7)
    expect(lines[0]).toBe('  + posts (new table)')
    expect(lines[1]).toBe('  ~ accounts (renamed from users)')
    expect(lines[2]).toBe('  accounts')
    expect(lines[3]).toBe('    + age (integer)')
    expect(lines[4]).toBe('  - old_logs (dropped)')
    expect(lines[5]).toBe('  orders')
    expect(lines[6]).toBe('    - legacy_id')
  })

  it('renders add_column with type info', () => {
    const changes: Change[] = [
      {
        type: 'modify_table',
        T: { name: 'users', columns: [] },
        changes: [{ type: 'add_column', C: { name: 'status', type: { type: { kind: 'string', T: 'text' } } } }],
      },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('    + status (text)')
  })

  it('renders modify_column with only nullability change', () => {
    const changes: Change[] = [
      {
        type: 'modify_table',
        T: { name: 'users', columns: [] },
        changes: [
          {
            type: 'modify_column',
            from: { name: 'email', type: { type: { kind: 'string', T: 'text' }, null: true } },
            to: { name: 'email', type: { type: { kind: 'string', T: 'text' }, null: false } },
            change: 0,
          },
        ],
      },
    ]
    const lines = renderChanges(changes).map(stripAnsi)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('    ~ email (set not null)')
  })
})
