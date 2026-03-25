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
      const stmts = result.statements!.join('\n').toLowerCase()
      expect(stmts).toContain('alter table')
      expect(stmts).toContain('price')
    }, 30_000)

    it('inspect captures views in SQLite schema', async () => {
      if (!runner) runner = await createRunner({ dialect: 'sqlite' })

      const sql = `
        CREATE TABLE orders (id INTEGER PRIMARY KEY, customer TEXT, total REAL);
        CREATE VIEW order_summary AS SELECT customer, SUM(total) as revenue FROM orders GROUP BY customer;
      `

      const result = await runner.inspect([sql], { dialect: 'sqlite' })

      expect(result.error).toBeUndefined()
      const schemas = result.schema!.schemas
      const views = schemas.flatMap((s) => (s as any).views ?? [])
      expect(views.length).toBe(1)
      expect(views[0].name).toBe('order_summary')
    }, 30_000)

    it('diff produces CREATE VIEW for new SQLite view', async () => {
      if (!runner) runner = await createRunner({ dialect: 'sqlite' })

      const from = 'CREATE TABLE orders (id INTEGER PRIMARY KEY, customer TEXT, total REAL);'
      const to = `
        CREATE TABLE orders (id INTEGER PRIMARY KEY, customer TEXT, total REAL);
        CREATE VIEW order_summary AS SELECT customer, SUM(total) as revenue FROM orders GROUP BY customer;
      `

      const result = await runner.diff([from], [to], { dialect: 'sqlite' })

      expect(result.error).toBeUndefined()
      expect(result.statements).toBeDefined()
      const stmts = result.statements!.join('\n').toUpperCase()
      expect(stmts).toContain('CREATE VIEW')
      expect(stmts).toContain('ORDER_SUMMARY')
    }, 30_000)

    it('inspect captures triggers in SQLite schema', async () => {
      if (!runner) runner = await createRunner({ dialect: 'sqlite' })

      const sql = `
        CREATE TABLE audit (id INTEGER PRIMARY KEY, action TEXT, ts TEXT DEFAULT (datetime('now')));
        CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TRIGGER items_after_insert AFTER INSERT ON items
        BEGIN
          INSERT INTO audit (action) VALUES ('insert:' || NEW.name);
        END;
      `

      const result = await runner.inspect([sql], { dialect: 'sqlite' })

      expect(result.error).toBeUndefined()
      const schemas = result.schema!.schemas
      const tables = schemas.flatMap((s) => s.tables ?? [])
      const itemsTable = tables.find((t) => t.name === 'items')
      expect(itemsTable).toBeDefined()
      const triggers = (itemsTable as any).triggers ?? []
      expect(triggers.length).toBe(1)
      expect(triggers[0].name).toBe('items_after_insert')
    }, 30_000)

    it('diff produces CREATE TRIGGER for new SQLite trigger', async () => {
      if (!runner) runner = await createRunner({ dialect: 'sqlite' })

      const from = `
        CREATE TABLE audit (id INTEGER PRIMARY KEY, action TEXT);
        CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);
      `
      const to = `
        CREATE TABLE audit (id INTEGER PRIMARY KEY, action TEXT);
        CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TRIGGER items_after_delete AFTER DELETE ON items
        BEGIN
          INSERT INTO audit (action) VALUES ('deleted:' || OLD.name);
        END;
      `

      const result = await runner.diff([from], [to], { dialect: 'sqlite' })

      expect(result.error).toBeUndefined()
      expect(result.statements).toBeDefined()
      const stmts = result.statements!.join('\n').toUpperCase()
      expect(stmts).toContain('CREATE TRIGGER')
      expect(stmts).toContain('ITEMS_AFTER_DELETE')
    }, 30_000)
  })

  describe('MySQL', () => {
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

    it('inspect captures views in MySQL schema', async () => {
      if (!runner) runner = await createRunner({ dialect: 'mysql' })

      const sql = `
        CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, customer VARCHAR(255), total DECIMAL(10,2));
        CREATE VIEW order_summary AS SELECT customer, SUM(total) as revenue FROM orders GROUP BY customer;
      `

      const result = await runner.inspect([sql], { dialect: 'mysql' })

      expect(result.error).toBeUndefined()
      const schemas = result.schema!.schemas
      const views = schemas.flatMap((s) => (s as any).views ?? [])
      expect(views.length).toBe(1)
      expect(views[0].name).toBe('order_summary')
    }, 120_000)

    it('diff produces CREATE VIEW for new MySQL view', async () => {
      if (!runner) runner = await createRunner({ dialect: 'mysql' })

      const from =
        'CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, customer VARCHAR(255), total DECIMAL(10,2));'
      const to = `
        CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, customer VARCHAR(255), total DECIMAL(10,2));
        CREATE VIEW order_summary AS SELECT customer, SUM(total) as revenue FROM orders GROUP BY customer;
      `

      const result = await runner.diff([from], [to], { dialect: 'mysql' })

      expect(result.error).toBeUndefined()
      expect(result.statements).toBeDefined()
      const stmts = result.statements!.join('\n').toUpperCase()
      expect(stmts).toContain('CREATE')
      expect(stmts).toContain('ORDER_SUMMARY')
    }, 120_000)

    it('inspect captures triggers in MySQL schema', async () => {
      if (!runner) runner = await createRunner({ dialect: 'mysql' })

      const sql = `
        CREATE TABLE audit (id INT AUTO_INCREMENT PRIMARY KEY, action VARCHAR(255));
        CREATE TABLE items (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255));
        CREATE TRIGGER items_after_insert AFTER INSERT ON items FOR EACH ROW INSERT INTO audit (action) VALUES (CONCAT('insert:', NEW.name));
      `

      const result = await runner.inspect([sql], { dialect: 'mysql' })

      expect(result.error).toBeUndefined()
      const schemas = result.schema!.schemas
      const tables = schemas.flatMap((s) => s.tables ?? [])
      const itemsTable = tables.find((t) => t.name === 'items')
      expect(itemsTable).toBeDefined()
      const triggers = (itemsTable as any).triggers ?? []
      expect(triggers.length).toBe(1)
      expect(triggers[0].name).toBe('items_after_insert')
    }, 120_000)

    it('diff produces CREATE TRIGGER for new MySQL trigger', async () => {
      if (!runner) runner = await createRunner({ dialect: 'mysql' })

      const from = `
        CREATE TABLE audit (id INT AUTO_INCREMENT PRIMARY KEY, action VARCHAR(255));
        CREATE TABLE items (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255));
      `
      const to = `
        CREATE TABLE audit (id INT AUTO_INCREMENT PRIMARY KEY, action VARCHAR(255));
        CREATE TABLE items (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255));
        CREATE TRIGGER items_after_delete AFTER DELETE ON items FOR EACH ROW INSERT INTO audit (action) VALUES (CONCAT('deleted:', OLD.name));
      `

      const result = await runner.diff([from], [to], { dialect: 'mysql' })

      expect(result.error).toBeUndefined()
      expect(result.statements).toBeDefined()
      const stmts = result.statements!.join('\n').toUpperCase()
      expect(stmts).toContain('CREATE TRIGGER')
      expect(stmts).toContain('ITEMS_AFTER_DELETE')
    }, 120_000)

    it('inspect captures functions in MySQL schema', async () => {
      if (!runner) runner = await createRunner({ dialect: 'mysql' })

      const sql = `
        CREATE FUNCTION add_tax(price DECIMAL(10,2)) RETURNS DECIMAL(10,2) DETERMINISTIC RETURN price * 1.1;
      `

      const result = await runner.inspect([sql], { dialect: 'mysql' })

      expect(result.error).toBeUndefined()
      const schemas = result.schema!.schemas
      const funcs = schemas.flatMap((s) => s.funcs ?? [])
      expect(funcs.length).toBeGreaterThanOrEqual(1)
      const addTax = funcs.find((f: any) => f.name === 'add_tax')
      expect(addTax).toBeDefined()
    }, 120_000)

    it('diff produces CREATE FUNCTION for new MySQL function', async () => {
      if (!runner) runner = await createRunner({ dialect: 'mysql' })

      const from = ''
      const to = `CREATE FUNCTION double_it(x INT) RETURNS INT DETERMINISTIC RETURN x * 2;`

      const result = await runner.diff([from], [to], { dialect: 'mysql' })

      expect(result.error).toBeUndefined()
      expect(result.statements).toBeDefined()
      const stmts = result.statements!.join('\n').toUpperCase()
      expect(stmts).toContain('CREATE FUNCTION')
      expect(stmts).toContain('DOUBLE_IT')
    }, 120_000)
  })
})
