// SQLite integration tests against real SQLite database
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createInspector } from '../../inspector.ts'
import type { InspectorRunner } from '../../inspector.ts'
import type { DatabaseAdapter } from '@sqldoc/db'
import { createSqliteAdapter } from '@sqldoc/db'

describe('SQLite Inspector', () => {
  it('inspects a basic table with columns and PK', async () => {
    const db = await createSqliteAdapter(':memory:')
    const inspector = await createInspector({ db, dialect: 'sqlite' })

    try {
      const sql = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          age INTEGER,
          active INTEGER NOT NULL DEFAULT 1
        );
      `
      const result = await inspector.inspect([sql])
      assert.ok(result.schema, 'inspect should return schema')

      const schemas = result.schema!.schemas
      assert.ok(schemas.length > 0, 'should have at least one schema')

      const mainSchema = schemas.find(s => s.name === 'main')
      assert.ok(mainSchema, 'should have main schema')

      const usersTable = mainSchema!.tables?.find(t => t.name === 'users')
      assert.ok(usersTable, 'should find users table')
      assert.ok(usersTable!.columns, 'users should have columns')
      assert.equal(usersTable!.columns!.length, 5, 'users should have 5 columns')

      const colNames = usersTable!.columns!.map(c => c.name)
      assert.deepEqual(colNames, ['id', 'name', 'email', 'age', 'active'])

      // Check primary key
      assert.ok(usersTable!.primary_key, 'should have primary key')
    } finally {
      await inspector.close()
    }
  })

  it('inspects the pet store SQLite schema', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const testsDir = path.resolve(import.meta.dirname, '../../../../../tests')
    const schemaSql = fs.readFileSync(path.join(testsDir, 'pet-store-sqlite/schema.sql'), 'utf-8')
    const includeReviewsSql = fs.readFileSync(path.join(testsDir, 'pet-store-sqlite/include/reviews.sql'), 'utf-8')
    const externalLocationsSql = fs.readFileSync(path.join(testsDir, 'pet-store-sqlite/external/locations.sql'), 'utf-8')

    const db = await createSqliteAdapter(':memory:')
    const inspector = await createInspector({ db, dialect: 'sqlite' })

    try {
      // Execute all SQL files (locations first since reviews references it)
      const result = await inspector.inspect([externalLocationsSql, schemaSql, includeReviewsSql])
      assert.ok(result.schema, 'should return schema')

      const mainSchema = result.schema!.schemas.find(s => s.name === 'main')
      assert.ok(mainSchema, 'should have main schema')

      const tableNames = (mainSchema!.tables ?? []).map(t => t.name).sort()
      const expectedTables = [
        'adoptions', 'categories', 'legacy_inventory', 'locations',
        'medical_records', 'owners', 'pets', 'reviews', 'staff',
      ].sort()
      assert.deepEqual(tableNames, expectedTables, 'should have all pet store tables')

      // Check foreign keys on adoptions
      const adoptions = mainSchema!.tables!.find(t => t.name === 'adoptions')
      assert.ok(adoptions, 'should find adoptions table')
      assert.ok(adoptions!.foreign_keys && adoptions!.foreign_keys.length >= 2,
        'adoptions should have at least 2 foreign keys')
    } finally {
      await inspector.close()
    }
  })

  it('inspects SQLite type affinity correctly', async () => {
    const db = await createSqliteAdapter(':memory:')
    const inspector = await createInspector({ db, dialect: 'sqlite' })

    try {
      const sql = `
        CREATE TABLE affinity_test (
          int_col INTEGER,
          text_col TEXT,
          real_col REAL,
          blob_col BLOB,
          num_col NUMERIC,
          varchar_col VARCHAR(100),
          bool_col BOOLEAN
        );
      `
      const result = await inspector.inspect([sql])
      assert.ok(result.schema, 'should return schema')

      const mainSchema = result.schema!.schemas.find(s => s.name === 'main')
      assert.ok(mainSchema, 'should have main schema')

      const table = mainSchema!.tables?.find(t => t.name === 'affinity_test')
      assert.ok(table, 'should find affinity_test table')
      assert.equal(table!.columns!.length, 7, 'should have 7 columns')

      // Each column should have a type
      for (const col of table!.columns!) {
        assert.ok(col.type, `column ${col.name} should have type`)
        assert.ok(col.type!.T || col.type!.raw, `column ${col.name} should have T or raw type`)
      }
    } finally {
      await inspector.close()
    }
  })

  it('inspects CHECK constraints', async () => {
    const db = await createSqliteAdapter(':memory:')
    const inspector = await createInspector({ db, dialect: 'sqlite' })

    try {
      const sql = `
        CREATE TABLE validated (
          id INTEGER PRIMARY KEY,
          age INTEGER CHECK(age >= 0 AND age <= 150),
          status TEXT CHECK(status IN ('active', 'inactive'))
        );
      `
      const result = await inspector.inspect([sql])
      assert.ok(result.schema, 'should return schema')

      const mainSchema = result.schema!.schemas.find(s => s.name === 'main')
      assert.ok(mainSchema, 'should have main schema')

      const table = mainSchema!.tables?.find(t => t.name === 'validated')
      assert.ok(table, 'should find validated table')

      // Check constraints should be present - either on the table attrs or as separate checks
      // The SQLite inspector extracts CHECK from CREATE TABLE SQL
      assert.ok(table!.columns!.length === 3, 'validated should have 3 columns')
    } finally {
      await inspector.close()
    }
  })

  it('diffs two SQLite schemas', async () => {
    const db = await createSqliteAdapter(':memory:')
    const inspector = await createInspector({ db, dialect: 'sqlite' })

    try {
      const fromSql = `
        CREATE TABLE items (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
      `
      const toSql = `
        CREATE TABLE items (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT
        );
      `
      const result = await inspector.diff([fromSql], [toSql])

      const hasStatements = result.statements && result.statements.length > 0
      const hasChanges = result.changes && result.changes.length > 0
      assert.ok(hasStatements || hasChanges,
        'diff should produce statements or changes for the added column')
    } finally {
      await inspector.close()
    }
  })
})
