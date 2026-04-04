import type { AtlasChange } from '@sqldoc/db'
import { describe, expect, it } from '@sqldoc/test-utils'
import { detectDestructiveChanges } from '../utils/destructive.ts'

describe('detectDestructiveChanges', () => {
  it('returns empty for non-destructive changes', () => {
    const changes: AtlasChange[] = [
      { type: 'add_table', table: 'users' },
      { type: 'add_column', table: 'users', name: 'email' },
      { type: 'add_index', table: 'users', name: 'idx_email' },
      { type: 'modify_column', table: 'users', name: 'email' },
    ]
    expect(detectDestructiveChanges(changes)).toEqual([])
  })

  it('detects drop_table', () => {
    const changes: AtlasChange[] = [{ type: 'drop_table', table: 'audit_log' }]
    const result = detectDestructiveChanges(changes)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ type: 'drop_table', table: 'audit_log' })
  })

  it('detects drop_column', () => {
    const changes: AtlasChange[] = [{ type: 'drop_column', table: 'users', name: 'legacy_id' }]
    const result = detectDestructiveChanges(changes)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('drop_column')
  })

  it('does not flag drop_index as destructive', () => {
    const changes: AtlasChange[] = [{ type: 'drop_index', table: 'users', name: 'idx_old' }]
    expect(detectDestructiveChanges(changes)).toEqual([])
  })

  it('does not flag drop_view as destructive', () => {
    const changes: AtlasChange[] = [{ type: 'drop_view', table: 'active_users' }]
    expect(detectDestructiveChanges(changes)).toEqual([])
  })

  it('does not flag drop_function as destructive', () => {
    const changes: AtlasChange[] = [{ type: 'drop_function', table: 'calculate_total' }]
    expect(detectDestructiveChanges(changes)).toEqual([])
  })

  it('does not flag modify_view or modify_function', () => {
    const changes: AtlasChange[] = [
      { type: 'modify_view', table: 'active_users' },
      { type: 'modify_function', table: 'calculate_total' },
    ]
    expect(detectDestructiveChanges(changes)).toEqual([])
  })

  it('filters only destructive from mixed changes', () => {
    const changes: AtlasChange[] = [
      { type: 'add_table', table: 'new_users' },
      { type: 'drop_table', table: 'audit_log' },
      { type: 'drop_column', table: 'users', name: 'legacy_id' },
      { type: 'drop_index', table: 'users', name: 'idx_old' },
      { type: 'drop_view', table: 'old_view' },
      { type: 'drop_function', table: 'old_func' },
      { type: 'modify_function', table: 'my_func' },
    ]
    const result = detectDestructiveChanges(changes)
    expect(result).toHaveLength(2)
    expect(result.map((c) => c.type)).toEqual(['drop_table', 'drop_column'])
  })
})
