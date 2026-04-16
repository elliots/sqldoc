// MSSQL integration tests against Docker
// Usage: node --test packages/inspector/src/__tests__/mssql/inspect.test.ts

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createContainerDbSource } from '@sqldoc/db'
import mssqlPlugin from '@sqldoc/db-mssql'
import type { InspectorRunner } from '../../inspector.ts'
import { createInspector } from '../../inspector.ts'

describe('MSSQL Inspector', () => {
  let inspector: InspectorRunner

  before(async () => {
    const source = await createContainerDbSource({
      devUrl: 'docker://mcr.microsoft.com/mssql/server:2022-latest',
      context: { dialect: 'mssql', extensions: [] },
      adapterPlugin: mssqlPlugin,
      reuseContainer: true,
    })
    inspector = await createInspector({ source, engine: 'mssql' })
  })

  after(async () => {
    if (inspector) await inspector.close()
  })

  it('inspects a basic table with columns, PK, and IDENTITY', async () => {
    const sql = `
      CREATE TABLE users (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        name NVARCHAR(100) NOT NULL,
        email NVARCHAR(255) UNIQUE,
        age INT,
        active BIT NOT NULL DEFAULT 1
      );
    `
    const result = await inspector.inspect([sql])
    assert.ok(result.schema, 'inspect should return schema')

    const schemas = result.schema!.schemas
    assert.ok(schemas.length > 0, 'should have at least one schema')

    let usersTable
    for (const schema of schemas) {
      usersTable = schema.tables?.find((t) => t.name === 'users')
      if (usersTable) break
    }
    assert.ok(usersTable, 'should find users table')
    assert.equal(usersTable!.columns.length, 5, 'users should have 5 columns')

    const colNames = usersTable!.columns.map((c) => c.name)
    assert.deepEqual(colNames, ['id', 'name', 'email', 'age', 'active'])

    assert.ok(usersTable!.primaryKey, 'should have primary key')
  })

  it('inspects foreign keys', async () => {
    const sql = `
      CREATE TABLE parent_t (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(100) NOT NULL
      );
      CREATE TABLE child_t (
        id INT IDENTITY(1,1) PRIMARY KEY,
        parent_id INT NOT NULL,
        CONSTRAINT FK_child_parent FOREIGN KEY (parent_id)
          REFERENCES parent_t(id) ON DELETE CASCADE
      );
    `
    const result = await inspector.inspect([sql])
    assert.ok(result.schema)

    let childTable
    for (const schema of result.schema!.schemas) {
      childTable = schema.tables?.find((t) => t.name === 'child_t')
      if (childTable) break
    }
    assert.ok(childTable, 'should find child_t')
    assert.ok(childTable!.foreignKeys && childTable!.foreignKeys.length > 0, 'should have foreign keys')

    const fk = childTable!.foreignKeys![0]
    assert.equal(fk.refTable, 'parent_t')
    assert.deepEqual(fk.columns, ['parent_id'])
    assert.equal(fk.onDelete, 'CASCADE')
  })

  it('inspects CHECK constraints', async () => {
    const sql = `
      CREATE TABLE rated (
        id INT IDENTITY(1,1) PRIMARY KEY,
        rating INT NOT NULL,
        CONSTRAINT CK_rated_rating CHECK (rating >= 1 AND rating <= 5)
      );
    `
    const result = await inspector.inspect([sql])

    let table
    for (const schema of result.schema!.schemas) {
      table = schema.tables?.find((t) => t.name === 'rated')
      if (table) break
    }
    assert.ok(table, 'should find rated table')
    assert.ok(table!.checks && table!.checks.length > 0, 'should have check constraints')
    assert.ok(table!.checks![0].expr.includes('rating'), 'check should reference rating')
  })

  it('self-diff produces zero changes', async () => {
    const sql = `
      CREATE TABLE diff_test (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(100) NOT NULL
      );
    `
    const result = await inspector.diff([sql], [sql])
    const stmtCount = result.statements?.length ?? 0
    assert.equal(stmtCount, 0, 'self-diff should produce zero statements')
  })

  it('diffs two schemas and detects added columns', async () => {
    const fromSql = `
      CREATE TABLE items (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(100) NOT NULL
      );
    `
    const toSql = `
      CREATE TABLE items (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(100) NOT NULL,
        description NVARCHAR(MAX),
        price DECIMAL(10,2) NOT NULL DEFAULT 0
      );
    `
    const result = await inspector.diff([fromSql], [toSql])
    const hasStatements = result.statements && result.statements.length > 0
    const hasChanges = result.changes && result.changes.length > 0
    assert.ok(hasStatements || hasChanges, 'diff should detect added columns')
  })
})
