import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import { filterSystemSchemas, getInspectorRuntime, resolveInspectorEngine } from '../../dialects.ts'
import type { Realm } from '../../schema/schema.ts'

function makeRealm(schemaNames: string[]): Realm {
  return {
    schemas: schemaNames.map((name) => ({ name, tables: [] })),
  }
}

describe('resolveInspectorEngine', () => {
  it('defaults engine identity from the dialect family', () => {
    assert.equal(resolveInspectorEngine({ dialect: 'postgres' }), 'postgres')
    assert.equal(resolveInspectorEngine({ dialect: 'mysql' }), 'mysql')
  })

  it('accepts explicit engine variants', () => {
    assert.equal(resolveInspectorEngine({ engine: 'crdb' }), 'crdb')
    assert.equal(resolveInspectorEngine({ dialect: 'mysql', engine: 'tidb' }), 'tidb')
    assert.equal(resolveInspectorEngine({ dialect: 'mssql', engine: 'azuresql' }), 'azuresql')
  })

  it('rejects mismatched engine and dialect combinations', () => {
    assert.throws(
      () => resolveInspectorEngine({ dialect: 'mysql', engine: 'crdb' }),
      /engine "crdb" belongs to dialect "postgres", got "mysql"/,
    )
    assert.throws(
      () => resolveInspectorEngine({ dialect: 'sqlite', engine: 'azuresql' }),
      /engine "azuresql" belongs to dialect "mssql", got "sqlite"/,
    )
  })
})

describe('filterSystemSchemas', () => {
  it('filters postgres system schemas including temporary schemas', () => {
    const realm = makeRealm(['public', 'information_schema', 'pg_catalog', 'pg_temp_3'])
    assert.deepEqual(
      filterSystemSchemas(realm, 'postgres').schemas.map((schema) => schema.name),
      ['public'],
    )
  })

  it('filters mysql system schemas', () => {
    const realm = makeRealm(['app', 'mysql', 'sys', 'performance_schema'])
    assert.deepEqual(
      filterSystemSchemas(realm, 'mysql').schemas.map((schema) => schema.name),
      ['app'],
    )
  })
})

describe('getInspectorRuntime', () => {
  it('combines engine variants with dialect-family runtime behavior', () => {
    const crdb = getInspectorRuntime('crdb')
    const tidb = getInspectorRuntime('tidb')

    assert.equal(crdb.dialect, 'postgres')
    assert.equal(crdb.statementBatchSize, 50)
    assert.equal(typeof crdb.scanStatements, 'function')

    assert.equal(tidb.dialect, 'mysql')
    assert.equal(tidb.statementBatchSize, 50)
    assert.equal(typeof tidb.isSystemSchema, 'function')
  })
})
