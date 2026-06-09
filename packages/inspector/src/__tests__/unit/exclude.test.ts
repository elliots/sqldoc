import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import { excludeRealm, excludeSchema } from '../../schema/exclude.ts'

describe('splitPatterns empty segments', () => {
  it('throws on pattern with empty segment like "public..users"', () => {
    const realm = { schemas: [{ name: 'public', tables: [], views: [] }] }
    assert.throws(() => excludeRealm(realm, ['public..users']), /empty segment/)
  })

  it('throws on pattern starting with dot', () => {
    const realm = { schemas: [{ name: 'public', tables: [], views: [] }] }
    assert.throws(() => excludeRealm(realm, ['.users']), /empty segment/)
  })

  it('trailing dot is treated as single-segment pattern (no extra empty segment pushed)', () => {
    // "public." splits to ["public"] because trailing empty is not pushed
    // This effectively excludes the "public" schema entirely
    const realm = { schemas: [{ name: 'public', tables: [], views: [] }] }
    excludeRealm(realm, ['public.'])
    assert.equal(realm.schemas.length, 0)
  })
})

describe('excludeSchema max depth', () => {
  it('throws when schema-relative pattern has more than 2 parts', () => {
    const schema = { name: 'public', tables: [], views: [] }
    assert.throws(() => excludeSchema(schema as any, ['a.b.c']), /too many parts/)
  })

  it('allows 2-part schema-relative pattern', () => {
    const schema = {
      name: 'public',
      tables: [{ name: 'users', columns: [{ name: 'id', type: { type: { kind: 'integer', T: 'int' } } }] }],
      views: [],
    }
    // Should not throw
    excludeSchema(schema as any, ['users.id'])
    // Column should be filtered out
    assert.equal(schema.tables[0].columns.length, 0)
  })
})

describe('excludeRealm max depth', () => {
  it('throws when realm pattern has more than 3 parts', () => {
    const realm = { schemas: [{ name: 'public', tables: [], views: [] }] }
    assert.throws(() => excludeRealm(realm, ['a.b.c.d']), /too many parts/)
  })
})
