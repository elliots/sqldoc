import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { realmDiff, schemaDiff } from '../../internal/diff.ts'
import { PostgresDiff } from '../../postgres/diff.ts'
import type { Realm, Schema } from '../../schema/schema.ts'

const driver = new PostgresDiff()

function makeSchema(name: string, tables: Schema['tables'] = []): Schema {
  return { name, tables }
}

function makeRealm(schemas: Schema[], defaultSchema?: string): Realm {
  return { schemas, defaultSchema }
}

function makeTable(name: string): Schema['tables'][0] {
  return { name, columns: [] }
}

describe('schemaDiff with matchDefaultSchemas', () => {
  it('throws on name mismatch when matchDefaultSchemas is false', () => {
    const from = makeSchema('public', [makeTable('users')])
    const to = makeSchema('production', [makeTable('users')])

    assert.throws(() => schemaDiff(driver, from, to, { matchDefaultSchemas: false }), /mismatched schema names/)
  })

  it('allows name mismatch when matchDefaultSchemas is true', () => {
    const from = makeSchema('public', [makeTable('users')])
    const to = makeSchema('production', [makeTable('users')])

    const changes = schemaDiff(driver, from, to, { matchDefaultSchemas: true })
    assert.deepEqual(changes, [])
  })
})

describe('realmDiff with matchDefaultSchemas', () => {
  it('matches default schemas with different names', () => {
    const from = makeRealm([makeSchema('sqldoc_dev', [makeTable('users')])], 'sqldoc_dev')
    const to = makeRealm([makeSchema('production', [makeTable('users')])], 'production')

    const changes = realmDiff(driver, from, to, { matchDefaultSchemas: true })
    // Should match the schemas as equivalent — no add/drop
    const schemaChanges = changes.filter((c) => c.type === 'add_schema' || c.type === 'drop_schema')
    assert.equal(schemaChanges.length, 0, 'should not add/drop default schemas')
  })

  it('does not match default schemas when matchDefaultSchemas is false', () => {
    const from = makeRealm([makeSchema('sqldoc_dev', [makeTable('users')])], 'sqldoc_dev')
    const to = makeRealm([makeSchema('production', [makeTable('users')])], 'production')

    const changes = realmDiff(driver, from, to, { matchDefaultSchemas: false })
    // Should see drop_schema + add_schema since names differ
    const dropSchema = changes.filter((c) => c.type === 'drop_schema')
    const addSchema = changes.filter((c) => c.type === 'add_schema')
    assert.equal(dropSchema.length, 1, 'should drop sqldoc_dev')
    assert.equal(addSchema.length, 1, 'should add production')
  })

  it('detects table changes across matched default schemas', () => {
    const from = makeRealm([makeSchema('dev', [makeTable('users')])], 'dev')
    const to = makeRealm([makeSchema('prod', [makeTable('users'), makeTable('orders')])], 'prod')

    const changes = realmDiff(driver, from, to, { matchDefaultSchemas: true })
    const addTable = changes.filter((c) => c.type === 'add_table')
    assert.equal(addTable.length, 1, 'should detect new orders table')
  })

  it('still matches non-default schemas by exact name', () => {
    const from = makeRealm(
      [makeSchema('public', [makeTable('users')]), makeSchema('audit', [makeTable('logs')])],
      'public',
    )
    const to = makeRealm(
      [makeSchema('production', [makeTable('users')]), makeSchema('audit', [makeTable('logs')])],
      'production',
    )

    const changes = realmDiff(driver, from, to, { matchDefaultSchemas: true })
    // public->production matched as defaults, audit matched by name — no schema-level changes
    const schemaChanges = changes.filter((c) => c.type === 'add_schema' || c.type === 'drop_schema')
    assert.equal(schemaChanges.length, 0)
  })

  it('handles missing defaultSchema gracefully', () => {
    const from = makeRealm([makeSchema('public', [makeTable('users')])])
    const to = makeRealm([makeSchema('production', [makeTable('users')])])

    const changes = realmDiff(driver, from, to, { matchDefaultSchemas: true })
    // No defaultSchema set — falls back to exact name matching
    const dropSchema = changes.filter((c) => c.type === 'drop_schema')
    const addSchema = changes.filter((c) => c.type === 'add_schema')
    assert.equal(dropSchema.length, 1)
    assert.equal(addSchema.length, 1)
  })
})
