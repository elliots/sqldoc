import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('db-mssql adapter package', () => {
  it('exports mssql plugin metadata', () => {
    assert.equal(plugin.apiVersion, 1)
    assert.equal(plugin.name, 'mssql')
    assert.deepEqual(plugin.schemes, ['mssql', 'sqlserver'])
    assert.deepEqual(plugin.dialects, ['mssql'])
    assert.equal(plugin.runtime, 'any')
    assert.equal(typeof plugin.createAdapter, 'function')
  })
})
