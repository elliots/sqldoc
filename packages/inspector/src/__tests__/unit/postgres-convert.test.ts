import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import { normalizeDefault, quote } from '../../postgres/convert.ts'

describe('postgres trimCast (via normalizeDefault)', () => {
  it('strips simple type cast like ::integer', () => {
    assert.equal(normalizeDefault('1::integer', 'integer'), '1')
  })

  it('strips short alias cast like ::int4', () => {
    assert.equal(normalizeDefault('0::int4', 'int4'), '0')
  })

  it('strips cast with parenthesized precision like ::numeric(10,2)', () => {
    assert.equal(normalizeDefault('3.14::numeric(10,2)', 'numeric'), '3.14')
  })

  it('leaves expression without cast unchanged', () => {
    assert.equal(normalizeDefault('now()', 'timestamptz'), 'now()')
  })

  it('does not strip cast when rest has special chars', () => {
    // If the rest after :: isn't a simple type ref, it should stay
    assert.equal(normalizeDefault('x::$special', 'text'), 'x::$special')
  })

  it('returns undefined for undefined input', () => {
    assert.equal(normalizeDefault(undefined, 'text'), undefined)
  })
})

describe('postgres quote()', () => {
  it('wraps a plain string in single quotes', () => {
    assert.equal(quote('hello'), "'hello'")
  })

  it('returns already-quoted string unchanged', () => {
    assert.equal(quote("'hello'"), "'hello'")
  })

  it('escapes embedded single quotes', () => {
    assert.equal(quote("it's"), "'it''s'")
  })

  it('re-quotes mismatched quote (unbalanced)', () => {
    // "'hello" is not properly quoted — should be re-quoted
    const result = quote("'hello")
    assert.equal(result, "'''hello'")
  })

  it('handles already-quoted with embedded escaped quotes', () => {
    assert.equal(quote("'it''s fine'"), "'it''s fine'")
  })

  it('handles empty string', () => {
    assert.equal(quote(''), "''")
  })
})
