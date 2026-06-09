import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import { parseFuncArgs } from '../../postgres/driver.ts'

describe('parseFuncArgs', () => {
  it('parses simple type args', () => {
    const result = parseFuncArgs('integer, text')
    assert.equal(result.length, 2)
    assert.equal(result[0].type.T, 'integer')
    assert.equal(result[1].type.T, 'text')
  })

  it('parses named args', () => {
    const result = parseFuncArgs('a integer, b text')
    assert.equal(result.length, 2)
    assert.equal(result[0].name, 'a')
    assert.equal(result[0].type.T, 'integer')
    assert.equal(result[1].name, 'b')
    assert.equal(result[1].type.T, 'text')
  })

  it('handles nested parens in type like numeric(10,2)', () => {
    const result = parseFuncArgs('x numeric(10,2)')
    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'x')
    // The comma inside parens should NOT split into two args
    assert.ok(result[0].type.T.includes('numeric'))
  })

  it('handles multiple args with nested parens', () => {
    const result = parseFuncArgs('a numeric(10,2), b varchar(255)')
    assert.equal(result.length, 2)
    assert.equal(result[0].name, 'a')
    assert.equal(result[1].name, 'b')
  })

  it('handles mode prefixes', () => {
    const result = parseFuncArgs('IN a integer, OUT b text')
    assert.equal(result.length, 2)
    assert.equal(result[0].mode, 'IN')
    assert.equal(result[0].name, 'a')
    assert.equal(result[1].mode, 'OUT')
    assert.equal(result[1].name, 'b')
  })

  it('handles empty string', () => {
    const result = parseFuncArgs('')
    assert.equal(result.length, 0)
  })

  it('handles single unnamed arg', () => {
    const result = parseFuncArgs('integer')
    assert.equal(result.length, 1)
    assert.equal(result[0].type.T, 'integer')
    assert.equal(result[0].name, undefined)
  })
})
