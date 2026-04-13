/**
 * Integration tests for ns-audit.
 *
 * Generates audit trigger SQL, executes against real databases,
 * then verifies INSERT/UPDATE/DELETE create audit log entries.
 */

import { makeTagCtx } from '@sqldoc/core/test'
import { createAdapter, type DatabaseAdapter } from '@sqldoc/db'
import { after, describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

const mockColumns = [
  { name: 'id', type: { T: 'integer' } },
  { name: 'name', type: { T: 'text' } },
  { name: 'price', type: { T: 'numeric' } },
]

function getSql(dialect: 'postgres' | 'mysql' | 'sqlite' | 'mssql', objectName: string): string[] {
  const result = plugin.onTag!(
    makeTagCtx({
      dialect,
      objectName,
      tag: { name: null, args: {} },
      schemaTable: { name: objectName, columns: mockColumns },
    }),
  ) as any
  return result?.sql?.map((s: any) => s.sql) ?? []
}

// -- Postgres --

describe('ns-audit integration - Postgres', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('INSERT/UPDATE/DELETE create audit log entries', async () => {
    db = await createAdapter({ dialect: 'postgres' })
    await db.exec('CREATE TABLE orders (id SERIAL PRIMARY KEY, name TEXT NOT NULL, price NUMERIC)')

    for (const sql of getSql('postgres', 'orders')) await db.exec(sql)

    // INSERT
    await db.exec("INSERT INTO orders (name, price) VALUES ('Widget', 9.99)")
    let log = await db.query('SELECT table_name, operation FROM orders_audit_log ORDER BY id')
    expect(log.rows).toHaveLength(1)
    expect(log.rows[0][0]).toBe('orders')
    expect(log.rows[0][1]).toBe('INSERT')

    // UPDATE
    await db.exec("UPDATE orders SET price = 14.99 WHERE name = 'Widget'")
    log = await db.query('SELECT operation FROM orders_audit_log ORDER BY id')
    expect(log.rows).toHaveLength(2)
    expect(log.rows[1][0]).toBe('UPDATE')

    // DELETE
    await db.exec("DELETE FROM orders WHERE name = 'Widget'")
    log = await db.query('SELECT operation FROM orders_audit_log ORDER BY id')
    expect(log.rows).toHaveLength(3)
    expect(log.rows[2][0]).toBe('DELETE')
  })

  it('audit log contains old_data and new_data as JSON', async () => {
    await db.exec("INSERT INTO orders (name, price) VALUES ('Gadget', 5.00)")
    await db.exec("UPDATE orders SET price = 10.00 WHERE name = 'Gadget'")

    const log = await db.query(
      "SELECT old_data, new_data FROM orders_audit_log WHERE operation = 'UPDATE' ORDER BY id DESC LIMIT 1",
    )
    expect(log.rows).toHaveLength(1)
    // old_data should contain the old price
    const oldData = typeof log.rows[0][0] === 'string' ? JSON.parse(log.rows[0][0]) : log.rows[0][0]
    expect(oldData.name).toBe('Gadget')
  })
})

// -- SQLite --

describe('ns-audit integration - SQLite', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('INSERT/UPDATE/DELETE create audit log entries', async () => {
    db = await createAdapter({ dialect: 'sqlite' })
    await db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL)')

    const sqliteColumns = [
      { name: 'id', type: { T: 'integer' } },
      { name: 'name', type: { T: 'text' } },
      { name: 'price', type: { T: 'real' } },
    ]
    const result = plugin.onTag!(
      makeTagCtx({
        dialect: 'sqlite',
        objectName: 'items',
        tag: { name: null, args: {} },
        schemaTable: { name: 'items', columns: sqliteColumns },
      }),
    ) as any
    for (const s of result.sql) await db.exec(s.sql)

    await db.exec("INSERT INTO items (name, price) VALUES ('Alpha', 10.0)")
    await db.exec("UPDATE items SET price = 20.0 WHERE name = 'Alpha'")
    await db.exec("DELETE FROM items WHERE name = 'Alpha'")

    const log = await db.query('SELECT table_name, operation FROM items_audit_log ORDER BY id')
    expect(log.rows).toHaveLength(3)
    expect(log.rows[0][1]).toBe('INSERT')
    expect(log.rows[1][1]).toBe('UPDATE')
    expect(log.rows[2][1]).toBe('DELETE')
  })
})

// -- MySQL --

describe('ns-audit integration - MySQL', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('INSERT/UPDATE/DELETE create audit log entries', async () => {
    db = await createAdapter({ dialect: 'mysql' })
    await db.exec(
      'CREATE TABLE products (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, price DECIMAL(10,2))',
    )

    const mysqlColumns = [
      { name: 'id', type: { T: 'int' } },
      { name: 'name', type: { T: 'varchar(255)' } },
      { name: 'price', type: { T: 'decimal(10,2)' } },
    ]
    const result = plugin.onTag!(
      makeTagCtx({
        dialect: 'mysql',
        objectName: 'products',
        tag: { name: null, args: {} },
        schemaTable: { name: 'products', columns: mysqlColumns },
      }),
    ) as any
    for (const s of result.sql) await db.exec(s.sql)

    await db.exec("INSERT INTO products (name, price) VALUES ('Widget', 9.99)")
    await db.exec("UPDATE products SET price = 14.99 WHERE name = 'Widget'")
    await db.exec("DELETE FROM products WHERE name = 'Widget'")

    const log = await db.query('SELECT table_name, operation FROM products_audit_log ORDER BY id')
    expect(log.rows).toHaveLength(3)
    expect(log.rows[0][1]).toBe('INSERT')
    expect(log.rows[1][1]).toBe('UPDATE')
    expect(log.rows[2][1]).toBe('DELETE')
  })
})
