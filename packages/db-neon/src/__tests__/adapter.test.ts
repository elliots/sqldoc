import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('db-neon adapter package', () => {
  it('exports neon plugin metadata', () => {
    assert.equal(plugin.apiVersion, 1)
    assert.equal(plugin.name, 'neon')
    assert.deepEqual(plugin.schemes, ['neon'])
    assert.deepEqual(plugin.dialects, ['postgres'])
    assert.equal(plugin.runtime, 'any')
    assert.equal(typeof plugin.createAdapter, 'function')
  })
})
