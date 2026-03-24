import { afterAll, describe, expect, it } from 'vitest'
import { createRunner } from '../index'
import type { AtlasRunner } from '../runner'

describe('Atlas WASI dialect validation', () => {
  describe('SQLite', () => {
    let runner: AtlasRunner

    afterAll(async () => {
      if (runner) await runner.close()
    })

    it('inspect produces valid schema for SQLite SQL', async () => {
      runner = await createRunner({ dialect: 'sqlite' })

      const sql = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          title TEXT NOT NULL,
          body TEXT
        );
      `

      const result = await runner.inspect([sql], { dialect: 'sqlite' })

      expect(result.error).toBeUndefined()
      expect(result.schema).toBeDefined()

      // SQLite uses "main" as default schema name (not "public" like Postgres)
      const schemas = result.schema!.schemas
      expect(schemas.length).toBeGreaterThan(0)

      // Find tables across all schemas
      const tables = schemas.flatMap((s) => s.tables ?? [])
      expect(tables.length).toBe(2)

      const userTable = tables.find((t) => t.name === 'users')
      expect(userTable).toBeDefined()
      expect(userTable!.columns!.length).toBeGreaterThanOrEqual(4)

      const postTable = tables.find((t) => t.name === 'posts')
      expect(postTable).toBeDefined()
    }, 30_000)

    it('diff produces migration SQL for SQLite schema changes', async () => {
      if (!runner) runner = await createRunner({ dialect: 'sqlite' })

      const from = 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);'
      const to = 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL);'

      const result = await runner.diff([from], [to], { dialect: 'sqlite' })

      expect(result.error).toBeUndefined()
      expect(result.statements).toBeDefined()
      expect(result.statements!.length).toBeGreaterThan(0)
      // SQLite ALTER TABLE ADD COLUMN
      const stmts = result.statements!.join('\n').toLowerCase()
      expect(stmts).toContain('alter table')
      expect(stmts).toContain('price')
    }, 30_000)
  })

  const hasDocker = (() => {
    try {
      const { execSync } = require('node:child_process')
      execSync('docker info', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()

  const describeDocker = hasDocker ? describe : describe.skip

  describeDocker('MySQL', () => {
    let runner: AtlasRunner

    afterAll(async () => {
      if (runner) await runner.close()
    })

    it('inspect produces valid schema for MySQL SQL', async () => {
      runner = await createRunner({ dialect: 'mysql' })

      const sql = `
        CREATE TABLE users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE posts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          title VARCHAR(255) NOT NULL,
          body TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
      `

      const result = await runner.inspect([sql], { dialect: 'mysql' })

      expect(result.error).toBeUndefined()
      expect(result.schema).toBeDefined()

      const schemas = result.schema!.schemas
      expect(schemas.length).toBeGreaterThan(0)

      const tables = schemas.flatMap((s) => s.tables ?? [])
      expect(tables.length).toBe(2)

      const userTable = tables.find((t) => t.name === 'users')
      expect(userTable).toBeDefined()
      expect(userTable!.columns!.length).toBeGreaterThanOrEqual(4)
    }, 120_000)

    it('diff produces migration SQL for MySQL schema changes', async () => {
      if (!runner) runner = await createRunner({ dialect: 'mysql' })

      const from = 'CREATE TABLE items (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255));'
      const to = 'CREATE TABLE items (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), price DECIMAL(10,2));'

      const result = await runner.diff([from], [to], { dialect: 'mysql' })

      expect(result.error).toBeUndefined()
      expect(result.statements).toBeDefined()
      expect(result.statements!.length).toBeGreaterThan(0)
      const stmts = result.statements!.join('\n').toLowerCase()
      expect(stmts).toContain('alter table')
      expect(stmts).toContain('price')
    }, 120_000)
  })
})
