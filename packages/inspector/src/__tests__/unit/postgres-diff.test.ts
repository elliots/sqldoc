import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import { PostgresDiff } from '../../postgres/diff.ts'

describe('PostgresDiff.indexPartAttrChanged (op_class)', () => {
  const diff = new PostgresDiff()

  it('detects op_class added', () => {
    const from = {
      name: 'idx_name',
      parts: [{ column: 'name', attrs: [] }],
    }
    const to = {
      name: 'idx_name',
      parts: [{ column: 'name', attrs: [{ kind: 'op_class', name: 'text_pattern_ops' }] }],
    }
    assert.ok(diff.indexPartAttrChanged(from, to, 0))
  })

  it('detects op_class removed', () => {
    const from = {
      name: 'idx_name',
      parts: [{ column: 'name', attrs: [{ kind: 'op_class', name: 'text_pattern_ops' }] }],
    }
    const to = {
      name: 'idx_name',
      parts: [{ column: 'name', attrs: [] }],
    }
    assert.ok(diff.indexPartAttrChanged(from, to, 0))
  })

  it('detects op_class changed', () => {
    const from = {
      name: 'idx_name',
      parts: [{ column: 'name', attrs: [{ kind: 'op_class', name: 'text_pattern_ops' }] }],
    }
    const to = {
      name: 'idx_name',
      parts: [{ column: 'name', attrs: [{ kind: 'op_class', name: 'varchar_pattern_ops' }] }],
    }
    assert.ok(diff.indexPartAttrChanged(from, to, 0))
  })

  it('returns false when op_class is unchanged', () => {
    const from = {
      name: 'idx_name',
      parts: [{ column: 'name', attrs: [{ kind: 'op_class', name: 'text_pattern_ops' }] }],
    }
    const to = {
      name: 'idx_name',
      parts: [{ column: 'name', attrs: [{ kind: 'op_class', name: 'text_pattern_ops' }] }],
    }
    assert.ok(!diff.indexPartAttrChanged(from, to, 0))
  })

  it('returns false when neither has op_class', () => {
    const from = {
      name: 'idx_name',
      parts: [{ column: 'name', attrs: [] }],
    }
    const to = {
      name: 'idx_name',
      parts: [{ column: 'name', attrs: [] }],
    }
    assert.ok(!diff.indexPartAttrChanged(from, to, 0))
  })
})
