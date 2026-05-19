import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import { parseType, quote } from '../../mysql/driver.ts'

describe('MySQL parseType boolean detection', () => {
  it('tinyint(1) is boolean', () => {
    const result = parseType('tinyint(1)')
    assert.equal(result.kind, 'boolean')
  })

  it('tinyint(2) is integer, not boolean', () => {
    const result = parseType('tinyint(2)')
    assert.equal(result.kind, 'integer')
  })

  it('int(1) is integer, NOT boolean', () => {
    const result = parseType('int(1)')
    assert.equal(result.kind, 'integer')
    assert.equal(result.T, 'int')
  })

  it('smallint(1) is integer, NOT boolean', () => {
    const result = parseType('smallint(1)')
    assert.equal(result.kind, 'integer')
  })

  it('bool is boolean', () => {
    const result = parseType('bool')
    assert.equal(result.kind, 'boolean')
  })

  it('boolean is boolean', () => {
    const result = parseType('boolean')
    assert.equal(result.kind, 'boolean')
  })
})

describe('MySQL quote()', () => {
  it('wraps value in single quotes', () => {
    assert.equal(quote('hello'), "'hello'")
  })

  it('does NOT use double quotes', () => {
    const result = quote('hello')
    assert.ok(!result.startsWith('"'), 'should not start with double quote')
    assert.ok(result.startsWith("'"), 'should start with single quote')
  })

  it('returns already single-quoted string unchanged', () => {
    assert.equal(quote("'hello'"), "'hello'")
  })

  it('escapes embedded single quotes', () => {
    assert.equal(quote("it's"), "'it''s'")
  })

  it('handles empty string', () => {
    assert.equal(quote(''), "''")
  })
})
