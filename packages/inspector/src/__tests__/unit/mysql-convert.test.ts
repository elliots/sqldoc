import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import { typeDDL } from '../../mysql/convert.ts'

describe('MySQL typeDDL enum/set quote escaping', () => {
  it('quotes plain enum values', () => {
    const result = typeDDL({ kind: 'enum', T: 'enum', values: ['active', 'inactive'] })
    assert.equal(result, "enum('active','inactive')")
  })

  it('escapes single quotes in enum values', () => {
    const result = typeDDL({ kind: 'enum', T: 'enum', values: ["Bob's", 'normal'] })
    assert.equal(result, "enum('Bob''s','normal')")
  })

  it('leaves already-quoted values unchanged', () => {
    const result = typeDDL({ kind: 'enum', T: 'enum', values: ["'already_quoted'", "'other'"] })
    assert.equal(result, "enum('already_quoted','other')")
  })

  it('escapes single quotes in set values', () => {
    const result = typeDDL({ kind: 'enum', T: 'set', values: ["it's", 'fine'] })
    assert.equal(result, "set('it''s','fine')")
  })

  it('handles empty values array', () => {
    const result = typeDDL({ kind: 'enum', T: 'enum', values: [] })
    assert.equal(result, 'enum()')
  })
})
