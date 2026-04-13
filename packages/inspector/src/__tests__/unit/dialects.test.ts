import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filterSystemSchemas, resolveInspectorDialectVariant, stripDefaultSchemaQualifier } from '../../dialects.ts'
import type { Realm } from '../../schema/schema.ts'

function makeRealm(schemaNames: string[]): Realm {
  return {
    schemas: schemaNames.map((name) => ({ name, tables: [] })),
  }
}

describe('resolveInspectorDialectVariant', () => {
  it('resolves dialect-specific variants', () => {
    assert.equal(resolveInspectorDialectVariant('postgres'), 'postgres')
    assert.equal(resolveInspectorDialectVariant('postgres', { crdb: true }), 'crdb')
    assert.equal(resolveInspectorDialectVariant('mysql', { tidb: true }), 'tidb')
    assert.equal(resolveInspectorDialectVariant('mssql', { azuresql: true }), 'azuresql')
  })

  it('rejects incompatible variant flags', () => {
    assert.throws(
      () => resolveInspectorDialectVariant('mysql', { crdb: true }),
      /crdb mode is only valid for postgres dialect/,
    )
    assert.throws(
      () => resolveInspectorDialectVariant('sqlite', { azuresql: true }),
      /azuresql mode is only valid for mssql dialect/,
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

describe('stripDefaultSchemaQualifier', () => {
  it('strips quoted default schema prefixes for each supported family', () => {
    assert.deepEqual(
      stripDefaultSchemaQualifier(['ALTER TABLE "public"."users" ADD COLUMN "x" INT'], 'postgres', 'public'),
      ['ALTER TABLE "users" ADD COLUMN "x" INT'],
    )
    assert.deepEqual(stripDefaultSchemaQualifier(['ALTER TABLE `app`.`users` ADD COLUMN `x` INT'], 'mysql', 'app'), [
      'ALTER TABLE `users` ADD COLUMN `x` INT',
    ])
    assert.deepEqual(stripDefaultSchemaQualifier(['ALTER TABLE [dbo].[users] ADD [x] INT'], 'mssql', 'dbo'), [
      'ALTER TABLE [users] ADD [x] INT',
    ])
  })
})
