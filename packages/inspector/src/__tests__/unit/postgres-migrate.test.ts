import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PostgresPlan } from '../../postgres/migrate.ts'

describe('PostgresPlan.dropObject', () => {
  const plan = new PostgresPlan()

  it('generates DROP TYPE for range_type', () => {
    const obj = { kind: 'range_type', T: 'float_range' }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TYPE "float_range"')
  })

  it('generates DROP TYPE for range_type with schema', () => {
    const obj = { kind: 'range_type', T: 'float_range', schema: 'custom' }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TYPE "custom"."float_range"')
  })

  it('generates DROP AGGREGATE for aggregate', () => {
    const obj = { kind: 'aggregate', name: 'array_agg_custom', args: ['integer'] }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP AGGREGATE "array_agg_custom"(integer)')
  })

  it('generates DROP AGGREGATE with schema', () => {
    const obj = { kind: 'aggregate', name: 'my_agg', args: ['text', 'integer'], schema: 'analytics' }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP AGGREGATE "analytics"."my_agg"(text, integer)')
  })

  it('generates DROP AGGREGATE with no args', () => {
    const obj = { kind: 'aggregate', name: 'my_agg', args: [] }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP AGGREGATE "my_agg"()')
  })

  it('generates DROP TYPE for composite', () => {
    const obj = { kind: 'composite', T: 'address_type' }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TYPE "address_type"')
  })

  it('generates DROP DOMAIN for domain', () => {
    const obj = { kind: 'domain', T: 'email_domain' }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP DOMAIN "email_domain"')
  })
})
