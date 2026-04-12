import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Builder, isQuoted } from '../../internal/sqlx.ts'

describe('Builder.Ident', () => {
  it('quotes a simple identifier', () => {
    const b = new Builder()
    b.Ident('users')
    assert.equal(b.toString(), '"users"')
  })

  it('escapes embedded double quotes', () => {
    const b = new Builder()
    b.Ident('weird"name')
    assert.equal(b.toString(), '"weird""name"')
  })

  it('escapes multiple embedded double quotes', () => {
    const b = new Builder()
    b.Ident('a"b"c')
    assert.equal(b.toString(), '"a""b""c"')
  })

  it('escapes backtick closing quote for MySQL builder', () => {
    const b = new Builder({ quoteOpening: '`', quoteClosing: '`' })
    b.Ident('col`name')
    assert.equal(b.toString(), '`col``name`')
  })

  it('handles empty string', () => {
    const b = new Builder()
    b.Ident('')
    assert.equal(b.toString(), '')
  })
})

describe('isQuoted', () => {
  it('recognizes single-quoted string', () => {
    assert.ok(isQuoted("'hello'", "'"))
  })

  it('recognizes double-quoted string', () => {
    assert.ok(isQuoted('"hello"', '"'))
  })

  it('rejects mismatched quotes', () => {
    assert.ok(!isQuoted('\'hello"', "'", '"'))
  })

  it('handles escaped quotes inside', () => {
    assert.ok(isQuoted("'it''s'", "'"))
  })

  it('rejects unescaped quote inside', () => {
    assert.ok(!isQuoted("'it's'", "'"))
  })
})
