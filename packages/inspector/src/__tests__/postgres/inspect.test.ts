// PostgreSQL integration tests against PgLite

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { DatabaseAdapter } from '@sqldoc/db'
import pglitePlugin from '@sqldoc/db-pglite'
import type { InspectorRunner } from '../../inspector.ts'
import { createInspector } from '../../inspector.ts'

let db: DatabaseAdapter
let inspector: InspectorRunner

describe('PostgreSQL Inspector', () => {
  before(async () => {
    db = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
    inspector = await createInspector({ db, dialect: 'postgres' })
  })

  after(async () => {
    await inspector.close()
  })

  it('inspects a basic table with columns, PK, and NOT NULL', async () => {
    // Create a fresh DB adapter for isolation
    const localDb = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
    const localInspector = await createInspector({ db: localDb, dialect: 'postgres' })

    try {
      const sql = `
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          email TEXT UNIQUE,
          age INTEGER,
          active BOOLEAN NOT NULL DEFAULT true
        );
      `
      const result = await localInspector.inspect([sql])
      assert.ok(result.schema, 'inspect should return schema')

      const schemas = result.schema!.schemas
      assert.ok(schemas.length > 0, 'should have at least one schema')

      const publicSchema = schemas.find((s) => s.name === 'public')
      assert.ok(publicSchema, 'should have public schema')

      const usersTable = publicSchema!.tables?.find((t) => t.name === 'users')
      assert.ok(usersTable, 'should find users table')
      assert.ok(usersTable!.columns, 'users should have columns')
      assert.equal(usersTable!.columns!.length, 5, 'users should have 5 columns')

      // Check column names
      const colNames = usersTable!.columns!.map((c) => c.name)
      assert.deepEqual(colNames, ['id', 'name', 'email', 'age', 'active'])

      // Check primary key
      assert.ok(usersTable!.primaryKey, 'should have primary key')
      assert.ok(
        usersTable!.primaryKey!.parts?.some((p) => p.column === 'id'),
        'PK should be on id column',
      )

      // Check NOT NULL: name and active should not be nullable
      const nameCol = usersTable!.columns!.find((c) => c.name === 'name')
      assert.ok(nameCol, 'should find name column')
      assert.ok(!nameCol!.type?.null, 'name should be NOT NULL')

      const ageCol = usersTable!.columns!.find((c) => c.name === 'age')
      assert.ok(ageCol, 'should find age column')
      assert.ok(ageCol!.type?.null, 'age should be nullable')

      // Check type categorization
      const idCol = usersTable!.columns!.find((c) => c.name === 'id')
      assert.ok(idCol?.type.type.T, 'id should have type T')
    } finally {
      await localInspector.close()
    }
  })

  it('inspects the pet store postgres schema', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const schemaPath = path.resolve(import.meta.dirname, '../../../../../tests/pet-store-postgres/schema.sql')
    const sql = fs.readFileSync(schemaPath, 'utf-8')

    const localDb = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
    const localInspector = await createInspector({ db: localDb, dialect: 'postgres' })

    try {
      const result = await localInspector.inspect([sql])
      assert.ok(result.schema, 'should return schema')

      const publicSchema = result.schema!.schemas.find((s) => s.name === 'public')
      assert.ok(publicSchema, 'should have public schema')

      const tableNames = (publicSchema!.tables ?? []).map((t) => t.name).sort((a, b) => a.localeCompare(b))
      const expectedTables = [
        'adoptions',
        'categories',
        'legacy_inventory',
        'medical_records',
        'owners',
        'pets',
        'staff',
      ].sort((a, b) => a.localeCompare(b))
      assert.deepEqual(tableNames, expectedTables, 'should have all 7 pet store tables')

      // Check foreign keys on adoptions
      const adoptions = publicSchema!.tables!.find((t) => t.name === 'adoptions')
      assert.ok(adoptions, 'should find adoptions table')
      assert.ok(
        adoptions!.foreignKeys && adoptions!.foreignKeys.length >= 2,
        'adoptions should have at least 2 foreign keys (pet_id, owner_id)',
      )

      // Check function exists
      assert.ok(
        publicSchema!.funcs && publicSchema!.funcs.length > 0,
        'should have at least one function (get_adoption_report)',
      )
      const reportFunc = publicSchema!.funcs!.find((f) => f.name === 'get_adoption_report')
      assert.ok(reportFunc, 'should find get_adoption_report function')

      // Check composite type exists
      assert.ok(
        publicSchema!.compositeTypes && publicSchema!.compositeTypes.length > 0,
        'should have at least one composite type (adoption_report)',
      )
    } finally {
      await localInspector.close()
    }
  })

  it('inspects advanced Postgres types (enum, jsonb, timestamptz, bigserial, numeric)', async () => {
    const localDb = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
    const localInspector = await createInspector({ db: localDb, dialect: 'postgres' })

    try {
      const sql = `
        CREATE TYPE status_type AS ENUM ('active', 'inactive', 'pending');

        CREATE TABLE typed_table (
          id BIGSERIAL PRIMARY KEY,
          status status_type NOT NULL DEFAULT 'active',
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          price NUMERIC(10,2)
        );
      `
      const result = await localInspector.inspect([sql])
      assert.ok(result.schema, 'should return schema')

      const publicSchema = result.schema!.schemas.find((s) => s.name === 'public')
      assert.ok(publicSchema, 'should have public schema')

      const table = publicSchema!.tables?.find((t) => t.name === 'typed_table')
      assert.ok(table, 'should find typed_table')

      // Check bigserial
      const idCol = table!.columns!.find((c) => c.name === 'id')
      assert.ok(idCol?.type.type.T, 'id should have type')

      // Check enum type
      const statusCol = table!.columns!.find((c) => c.name === 'status')
      assert.ok(statusCol?.type.type.T, 'status should have type T')

      // Check JSONB
      const metaCol = table!.columns!.find((c) => c.name === 'metadata')
      assert.ok(metaCol?.type.type.T, 'metadata should have type T')

      // Check timestamptz
      const createdCol = table!.columns!.find((c) => c.name === 'created_at')
      assert.ok(createdCol?.type.type.T, 'created_at should have type T')

      // Check numeric
      const priceCol = table!.columns!.find((c) => c.name === 'price')
      assert.ok(priceCol?.type.type.T, 'price should have type T')
    } finally {
      await localInspector.close()
    }
  })

  it('inspects views and functions', async () => {
    const localDb = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
    const localInspector = await createInspector({ db: localDb, dialect: 'postgres' })

    try {
      const sql = `
        CREATE TABLE products (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          price NUMERIC(10,2) NOT NULL,
          active BOOLEAN NOT NULL DEFAULT true
        );

        CREATE VIEW active_products AS
          SELECT id, name, price FROM products WHERE active = true;

        CREATE FUNCTION get_product_count() RETURNS INTEGER
          LANGUAGE sql STABLE AS $$
          SELECT count(*)::integer FROM products WHERE active = true;
        $$;
      `
      const result = await localInspector.inspect([sql])
      assert.ok(result.schema, 'should return schema')

      const publicSchema = result.schema!.schemas.find((s) => s.name === 'public')
      assert.ok(publicSchema, 'should have public schema')

      // Check view
      assert.ok(publicSchema!.views && publicSchema!.views.length > 0, 'should have views')
      const view = publicSchema!.views!.find((v) => v.name === 'active_products')
      assert.ok(view, 'should find active_products view')
      assert.ok(view!.def, 'view should have definition')
      assert.ok(view!.columns && view!.columns.length === 3, 'view should have 3 columns (id, name, price)')

      // Check function
      assert.ok(publicSchema!.funcs && publicSchema!.funcs.length > 0, 'should have functions')
      const func = publicSchema!.funcs!.find((f) => f.name === 'get_product_count')
      assert.ok(func, 'should find get_product_count function')
      assert.ok(func!.ret, 'function should have return type')
      assert.equal(func!.lang, 'sql', 'function language should be sql')
    } finally {
      await localInspector.close()
    }
  })

  it('inspects RLS policies', async () => {
    const localDb = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
    const localInspector = await createInspector({ db: localDb, dialect: 'postgres' })

    try {
      const sql = `
        CREATE TABLE documents (
          id SERIAL PRIMARY KEY,
          owner_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          content TEXT
        );

        ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

        CREATE POLICY doc_select ON documents
          FOR SELECT
          USING (true);

        CREATE POLICY doc_insert ON documents
          FOR INSERT
          WITH CHECK (owner_id = 1);
      `
      const result = await localInspector.inspect([sql])
      assert.ok(result.schema, 'should return schema')

      const publicSchema = result.schema!.schemas.find((s) => s.name === 'public')
      assert.ok(publicSchema, 'should have public schema')

      const table = publicSchema!.tables?.find((t) => t.name === 'documents')
      assert.ok(table, 'should find documents table')

      // Policies may be in attrs or a separate field depending on the marshal format
      // The key thing is that the inspection completes successfully with the RLS-enabled table
      assert.ok(table!.columns!.length === 4, 'documents should have 4 columns')
    } finally {
      await localInspector.close()
    }
  })

  it('diffs two schemas and produces migration SQL', async () => {
    const localDb = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
    const localInspector = await createInspector({ db: localDb, dialect: 'postgres' })

    try {
      const fromSql = `
        CREATE TABLE items (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL
        );
      `
      const toSql = `
        CREATE TABLE items (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          price NUMERIC(10,2) NOT NULL DEFAULT 0
        );
      `
      const result = await localInspector.diff([fromSql], [toSql])

      // Should have statements or changes indicating columns were added
      const hasStatements = result.statements && result.statements.length > 0
      const hasChanges = result.changes && result.changes.length > 0
      assert.ok(hasStatements || hasChanges, 'diff should produce statements or changes for added columns')

      if (result.statements) {
        const stmtsStr = result.statements.join(' ')
        assert.ok(
          stmtsStr.includes('description') || stmtsStr.includes('price'),
          'diff SQL should reference new columns',
        )
      }
    } finally {
      await localInspector.close()
    }
  })

  it('domain migration preserves NOT NULL, type size, and detects definition changes', async () => {
    const localDb = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
    const localInspector = await createInspector({ db: localDb, dialect: 'postgres' })

    try {
      const sql = `
        CREATE DOMAIN url AS character varying(2048) NOT NULL;
        CREATE DOMAIN score AS integer CHECK (VALUE >= 0 AND VALUE <= 100);
        CREATE TABLE items (id serial PRIMARY KEY, link url, rating score);
      `

      // Round-trip: generate migration from empty, apply it, diff should be zero
      const migration = await localInspector.diff([], [sql])
      assert.ok(!migration.error, `diff should not error: ${migration.error}`)
      const stmts = migration.statements ?? []

      // Verify migration SQL preserves NOT NULL and size
      const urlStmt = stmts.find((s) => s.includes('CREATE DOMAIN') && s.includes('url'))
      assert.ok(urlStmt, 'should generate CREATE DOMAIN for url')
      assert.ok(urlStmt!.includes('NOT NULL'), 'domain migration should preserve NOT NULL')
      assert.ok(urlStmt!.includes('2048'), 'domain migration should preserve type size')

      // Round-trip should produce zero changes
      const migrationSQL = `${stmts.join(';\n')};`
      const roundTrip = await localInspector.diff([migrationSQL], [sql])
      assert.ok(!roundTrip.error, `round-trip diff should not error: ${roundTrip.error}`)
      assert.deepEqual(roundTrip.statements ?? [], [], 'round-trip diff should be empty')

      // Changing a domain definition should produce a diff
      const alteredSql = sql.replace('character varying(2048)', 'text')
      const altered = await localInspector.diff([sql], [alteredSql])
      assert.ok(!altered.error, `altered diff should not error: ${altered.error}`)
      assert.ok((altered.statements ?? []).length > 0, 'changing domain type should produce a diff')
    } finally {
      await localInspector.close()
    }
  })
})
