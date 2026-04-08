/**
 * Integration tests for ns-history.
 *
 * Generates SQL via the plugin, executes it against real databases,
 * inserts/updates/deletes data, then verifies history table has correct records.
 */

import { makeTagCtx } from '@sqldoc/core/test'
import { createAdapter, type DatabaseAdapter } from '@sqldoc/db'
import { after, describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

function getSql(
  dialect: 'postgres' | 'mysql' | 'sqlite',
  objectName: string,
  columns: Array<{ name: string; type: { T: string; null?: boolean } }>,
): string[] {
  const result = plugin.onTag!(
    makeTagCtx({
      dialect,
      objectName,
      tag: { name: null, args: {} },
      atlasTable: { name: objectName, columns },
    }),
  ) as any
  return result?.sql?.map((s: any) => s.sql) ?? []
}

const pgColumns = [
  { name: 'id', type: { T: 'integer', null: false } },
  { name: 'name', type: { T: 'text', null: false } },
  { name: 'price', type: { T: 'numeric', null: true } },
]

// -- Postgres --

describe('ns-history integration - Postgres', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('UPDATE creates history record with old values', async () => {
    db = await createAdapter({ dialect: 'postgres' })
    await db.exec('CREATE TABLE products (id SERIAL PRIMARY KEY, name TEXT NOT NULL, price NUMERIC)')
    for (const sql of getSql('postgres', 'products', pgColumns)) await db.exec(sql)

    await db.exec("INSERT INTO products (name, price) VALUES ('Widget', 9.99)")
    await db.exec("UPDATE products SET price = 14.99 WHERE name = 'Widget'")

    const history = await db.query('SELECT name, price, history_operation FROM products_history ORDER BY history_id')
    expect(history.rows).toHaveLength(1)
    expect(history.rows[0][0]).toBe('Widget')
    expect(Number(history.rows[0][1])).toBe(9.99)
    expect(history.rows[0][2]).toBe('UPDATE')
  })

  it('DELETE creates history record', async () => {
    await db.exec("INSERT INTO products (name, price) VALUES ('Gadget', 5.00)")
    await db.exec("DELETE FROM products WHERE name = 'Gadget'")

    const history = await db.query("SELECT name, history_operation FROM products_history WHERE name = 'Gadget'")
    expect(history.rows).toHaveLength(1)
    expect(history.rows[0][1]).toBe('DELETE')
  })

  it('multiple updates create multiple history records', async () => {
    await db.exec("UPDATE products SET price = 19.99 WHERE name = 'Widget'")
    await db.exec("UPDATE products SET price = 24.99 WHERE name = 'Widget'")

    const history = await db.query("SELECT price FROM products_history WHERE name = 'Widget' ORDER BY history_id")
    expect(history.rows).toHaveLength(3)
    expect(Number(history.rows[0][0])).toBe(9.99)
    expect(Number(history.rows[1][0])).toBe(14.99)
    expect(Number(history.rows[2][0])).toBe(19.99)
  })
})

// -- SQLite --

describe('ns-history integration - SQLite', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('UPDATE and DELETE create history records', async () => {
    db = await createAdapter({ dialect: 'sqlite' })
    await db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL)')

    const sqliteColumns = [
      { name: 'id', type: { T: 'integer', null: false } },
      { name: 'name', type: { T: 'text', null: false } },
      { name: 'price', type: { T: 'real', null: true } },
    ]
    for (const sql of getSql('sqlite', 'items', sqliteColumns)) await db.exec(sql)

    await db.exec("INSERT INTO items (name, price) VALUES ('Alpha', 10.0)")
    await db.exec("UPDATE items SET price = 20.0 WHERE name = 'Alpha'")
    await db.exec("INSERT INTO items (name, price) VALUES ('Beta', 5.0)")
    await db.exec("DELETE FROM items WHERE name = 'Beta'")

    const history = await db.query('SELECT name, history_operation FROM items_history ORDER BY history_id')
    expect(history.rows).toHaveLength(2)
    expect(history.rows[0][0]).toBe('Alpha')
    expect(history.rows[0][1]).toBe('UPDATE')
    expect(history.rows[1][0]).toBe('Beta')
    expect(history.rows[1][1]).toBe('DELETE')
  })
})

// -- MySQL --

describe('ns-history integration - MySQL', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('UPDATE and DELETE create history records', async () => {
    db = await createAdapter({ dialect: 'mysql' })
    await db.exec(
      'CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, price DECIMAL(10,2))',
    )

    const mysqlColumns = [
      { name: 'id', type: { T: 'int', null: false } },
      { name: 'name', type: { T: 'varchar(255)', null: false } },
      { name: 'price', type: { T: 'decimal(10,2)', null: true } },
    ]
    for (const sql of getSql('mysql', 'orders', mysqlColumns)) await db.exec(sql)

    await db.exec("INSERT INTO orders (name, price) VALUES ('Order1', 100.00)")
    await db.exec("UPDATE orders SET price = 150.00 WHERE name = 'Order1'")
    await db.exec("INSERT INTO orders (name, price) VALUES ('Order2', 50.00)")
    await db.exec("DELETE FROM orders WHERE name = 'Order2'")

    const history = await db.query('SELECT name, history_operation FROM orders_history ORDER BY history_id')
    expect(history.rows).toHaveLength(2)
    expect(history.rows[0][0]).toBe('Order1')
    expect(history.rows[0][1]).toBe('UPDATE')
    expect(history.rows[1][0]).toBe('Order2')
    expect(history.rows[1][1]).toBe('DELETE')
  })
})
