import type { Change } from '@sqldoc/db'
import { describe, expect, it } from '@sqldoc/test-utils'
import { detectDestructiveChanges } from '../utils/destructive.ts'

// Helpers to build Change objects for tests
const col = (name: string) => ({ name, type: { type: { kind: 'string' as const, T: 'text' } } })
const tbl = (name: string) => ({ name, columns: [col('id')] })
const idx = (name: string) => ({ name, parts: [{ column: 'id' }] })

describe('detectDestructiveChanges', () => {
  it('returns empty for non-destructive changes', () => {
    const changes: Change[] = [
      { type: 'add_table', T: tbl('users') },
      {
        type: 'modify_table',
        T: tbl('users'),
        changes: [
          { type: 'add_column', C: col('email') },
          { type: 'add_index', I: idx('idx_email') },
          { type: 'modify_column', from: col('email'), to: col('email'), change: 0 },
        ],
      },
    ]
    expect(detectDestructiveChanges(changes)).toEqual([])
  })

  it('detects drop_table', () => {
    const changes: Change[] = [{ type: 'drop_table', T: tbl('audit_log') }]
    const result = detectDestructiveChanges(changes)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('drop_table')
  })

  it('detects drop_column nested in modify_table', () => {
    const changes: Change[] = [
      { type: 'modify_table', T: tbl('users'), changes: [{ type: 'drop_column', C: col('legacy_id') }] },
    ]
    const result = detectDestructiveChanges(changes)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('drop_column')
  })

  it('does not flag drop_index as destructive', () => {
    const changes: Change[] = [
      { type: 'modify_table', T: tbl('users'), changes: [{ type: 'drop_index', I: idx('idx_old') }] },
    ]
    expect(detectDestructiveChanges(changes)).toEqual([])
  })

  it('does not flag drop_view as destructive', () => {
    const changes: Change[] = [{ type: 'drop_view', V: { name: 'active_users' } }]
    expect(detectDestructiveChanges(changes)).toEqual([])
  })

  it('does not flag drop_func as destructive', () => {
    const changes: Change[] = [{ type: 'drop_func', F: { name: 'calculate_total' } }]
    expect(detectDestructiveChanges(changes)).toEqual([])
  })

  it('does not flag modify_view or modify_func', () => {
    const changes: Change[] = [
      { type: 'modify_view', from: { name: 'v1' }, to: { name: 'v1' } },
      { type: 'modify_func', from: { name: 'f1' }, to: { name: 'f1' } },
    ]
    expect(detectDestructiveChanges(changes)).toEqual([])
  })

  it('detects drop_schema', () => {
    const changes: Change[] = [{ type: 'drop_schema', S: { name: 'analytics' } }]
    const result = detectDestructiveChanges(changes)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('drop_schema')
  })

  it('detects drop_column nested in modify_schema -> modify_table', () => {
    const changes: Change[] = [
      {
        type: 'modify_schema',
        S: { name: 'public' },
        changes: [{ type: 'modify_table', T: tbl('users'), changes: [{ type: 'drop_column', C: col('old_field') }] }],
      },
    ]
    const result = detectDestructiveChanges(changes)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('drop_column')
  })

  it('filters only destructive from mixed changes', () => {
    const changes: Change[] = [
      { type: 'add_table', T: tbl('new_users') },
      { type: 'drop_table', T: tbl('audit_log') },
      {
        type: 'modify_table',
        T: tbl('users'),
        changes: [
          { type: 'drop_column', C: col('legacy_id') },
          { type: 'drop_index', I: idx('idx_old') },
        ],
      },
      { type: 'drop_view', V: { name: 'old_view' } },
      { type: 'drop_func', F: { name: 'old_func' } },
      { type: 'modify_func', from: { name: 'my_func' }, to: { name: 'my_func' } },
    ]
    const result = detectDestructiveChanges(changes)
    expect(result).toHaveLength(2)
    expect(result.map((c) => c.type)).toEqual(['drop_table', 'drop_column'])
  })
})
