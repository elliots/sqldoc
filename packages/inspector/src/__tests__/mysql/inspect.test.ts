// MySQL integration tests against Docker/testcontainers
// Opt-in via MYSQL_TEST=1 (container startup is slow ~30s)
// Usage: MYSQL_TEST=1 bun test packages/inspector/src/__tests__/mysql/

import assert from 'node:assert/strict'
import { after, before, describe, it } from '@sqldoc/test-utils'

// MySQL tests are slow (container startup ~30s). Opt-in via MYSQL_TEST=1.
const optIn = process.env.MYSQL_TEST === '1'

if (!optIn) {
  // bun test's node:test polyfill does not honor { skip } on describe,
  // so we guard at module level and register a placeholder test.
  it('MySQL Inspector (skipped: set MYSQL_TEST=1 to run)', () => {
    // Intentionally empty -- serves as skip marker in test output
  })
} else {
  // Dynamic imports only when actually running MySQL tests
  const { createInspector } = await import('../../inspector.ts')
  const { createContainerDbSource } = await import('@sqldoc/db')
  type InspectorRunner = import('../../inspector.ts').InspectorRunner

  describe('MySQL Inspector', () => {
    let inspector: InspectorRunner

    before(async () => {
      const source = await createContainerDbSource({
        devUrl: 'docker://mysql:8',
        context: { dialect: 'mysql', extensions: [] },
      })
      inspector = await createInspector({ source, engine: 'mysql' })
    })

    after(async () => {
      if (inspector) await inspector.close()
    })

    it('inspects a basic table with columns, PK, and AUTO_INCREMENT', async () => {
      const sql = `
        CREATE TABLE users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(255) UNIQUE,
          age INT,
          active TINYINT(1) NOT NULL DEFAULT 1
        ) ENGINE=InnoDB;
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
      assert.ok(usersTable!.columns, 'users should have columns')
      assert.equal(usersTable!.columns!.length, 5, 'users should have 5 columns')

      const colNames = usersTable!.columns!.map((c) => c.name)
      assert.deepEqual(colNames, ['id', 'name', 'email', 'age', 'active'])

      assert.ok(usersTable!.primaryKey, 'should have primary key')
    })

    it('inspects the pet store MySQL schema', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')

      const schemaPath = path.resolve(import.meta.dirname, '../../../../../tests/pet-store-mysql/schema.sql')
      const sql = fs.readFileSync(schemaPath, 'utf-8')

      const result = await inspector.inspect([sql])
      assert.ok(result.schema, 'should return schema')

      const tableNames: string[] = []
      for (const schema of result.schema!.schemas) {
        tableNames.push(...(schema.tables ?? []).map((t) => t.name))
      }
      tableNames.sort()

      const expectedTables = [
        'adoptions',
        'categories',
        'legacy_inventory',
        'medical_records',
        'owners',
        'pets',
        'staff',
      ].sort()
      assert.deepEqual(tableNames, expectedTables, 'should have all 7 pet store tables')
    })

    it('inspects MySQL-specific features (AUTO_INCREMENT, ENUM, index types)', async () => {
      const sql = `
        CREATE TABLE features (
          id INT AUTO_INCREMENT PRIMARY KEY,
          status ENUM('active', 'inactive', 'pending') NOT NULL DEFAULT 'active',
          name VARCHAR(100) NOT NULL,
          description TEXT,
          FULLTEXT INDEX ft_name (name)
        ) ENGINE=InnoDB;
      `
      const result = await inspector.inspect([sql])
      assert.ok(result.schema, 'inspect should return schema')

      let featuresTable
      for (const schema of result.schema!.schemas) {
        featuresTable = schema.tables?.find((t) => t.name === 'features')
        if (featuresTable) break
      }
      assert.ok(featuresTable, 'should find features table')

      const statusCol = featuresTable!.columns!.find((c) => c.name === 'status')
      assert.ok(statusCol?.type?.type?.T || statusCol?.type?.raw, 'status should have type metadata')

      assert.ok(featuresTable!.indexes && featuresTable!.indexes.length > 0, 'should have indexes')
    })

    it('diffs two MySQL schemas', async () => {
      const fromSql = `
        CREATE TABLE items (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL
        ) ENGINE=InnoDB;
      `
      const toSql = `
        CREATE TABLE items (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          price DECIMAL(10,2) NOT NULL DEFAULT 0
        ) ENGINE=InnoDB;
      `
      const result = await inspector.diff([fromSql], [toSql])

      const hasStatements = result.statements && result.statements.length > 0
      const hasChanges = result.changes && result.changes.length > 0
      assert.ok(hasStatements || hasChanges, 'diff should produce statements or changes for added columns')
    })
  })
}
