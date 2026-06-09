import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('db-mysql adapter package', () => {
  it('exports mysql plugin metadata', () => {
    assert.equal(plugin.apiVersion, 1)
    assert.equal(plugin.name, 'mysql')
    assert.deepEqual(plugin.schemes, ['mysql'])
    assert.deepEqual(plugin.dialects, ['mysql'])
    assert.equal(plugin.runtime, 'any')
    assert.equal(typeof plugin.createAdapter, 'function')
  })
})
