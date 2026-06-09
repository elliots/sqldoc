import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('db-postgres adapter package', () => {
  it('exports postgres plugin metadata', () => {
    assert.equal(plugin.apiVersion, 1)
    assert.equal(plugin.name, 'postgres')
    assert.deepEqual(plugin.schemes, ['postgres', 'postgresql'])
    assert.deepEqual(plugin.dialects, ['postgres'])
    assert.equal(plugin.runtime, 'node')
    assert.equal(typeof plugin.createAdapter, 'function')
  })
})
