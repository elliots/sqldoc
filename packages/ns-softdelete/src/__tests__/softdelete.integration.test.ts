/**
 * Integration tests for ns-softdelete.
 *
 * Generates SQL via the plugin, executes it against real databases,
 * inserts test data, then verifies soft-delete behavior works correctly.
 */

import { makeTagCtx } from '@sqldoc/core/test'
import { createAdapter, type DatabaseAdapter } from '@sqldoc/db'
import { after, describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

function getSql(dialect: 'postgres' | 'mysql' | 'sqlite' | 'mssql', objectName: string): string[] {
  const result = plugin.onTag!(makeTagCtx({ dialect, objectName, tag: { name: null, args: {} } })) as any
  return result?.sql?.map((s: any) => s.sql) ?? []
}

// -- Postgres --

describe('ns-softdelete integration - Postgres', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('active view filters soft-deleted rows', async () => {
    db = await createAdapter({ dialect: 'postgres' })
    await db.exec('CREATE TABLE products (id SERIAL PRIMARY KEY, name TEXT NOT NULL)')
    for (const sql of getSql('postgres', 'products')) await db.exec(sql)

    await db.exec("INSERT INTO products (name) VALUES ('Widget')")
    await db.exec("INSERT INTO products (name, deleted_at) VALUES ('Gadget', NOW())")

    const active = await db.query('SELECT name FROM products_active')
    expect(active.rows).toHaveLength(1)
    expect(active.rows[0][0]).toBe('Widget')
  })

  it('soft-delete then restore', async () => {
    await db.exec("UPDATE products SET deleted_at = NOW() WHERE name = 'Widget'")
    expect((await db.query('SELECT name FROM products_active')).rows).toHaveLength(0)

    await db.exec("UPDATE products SET deleted_at = NULL WHERE name = 'Widget'")
    expect((await db.query('SELECT name FROM products_active')).rows).toHaveLength(1)
  })
})

// -- SQLite --

describe('ns-softdelete integration - SQLite', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('active view filters soft-deleted rows', async () => {
    db = await createAdapter({ dialect: 'sqlite' })
    await db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    for (const sql of getSql('sqlite', 'items')) await db.exec(sql)

    await db.exec("INSERT INTO items (name) VALUES ('Alpha')")
    await db.exec("INSERT INTO items (name, deleted_at) VALUES ('Beta', datetime('now'))")

    const active = await db.query('SELECT name FROM items_active')
    expect(active.rows).toHaveLength(1)
    expect(active.rows[0][0]).toBe('Alpha')
  })
})

// -- MySQL --

describe('ns-softdelete integration - MySQL', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('active view filters soft-deleted rows', async () => {
    db = await createAdapter({ dialect: 'mysql' })
    await db.exec('CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, total DECIMAL(10,2) NOT NULL)')
    for (const sql of getSql('mysql', 'orders')) await db.exec(sql)

    await db.exec('INSERT INTO orders (total) VALUES (99.99)')
    await db.exec('INSERT INTO orders (total, deleted_at) VALUES (49.99, NOW())')

    const active = await db.query('SELECT total FROM orders_active')
    expect(active.rows).toHaveLength(1)

    const all = await db.query('SELECT total FROM orders')
    expect(all.rows).toHaveLength(2)
  })

  it('soft-delete then restore', async () => {
    await db.exec('UPDATE orders SET deleted_at = NOW() WHERE total = 99.99')
    expect((await db.query('SELECT total FROM orders_active')).rows).toHaveLength(0)

    await db.exec('UPDATE orders SET deleted_at = NULL WHERE total = 99.99')
    expect((await db.query('SELECT total FROM orders_active')).rows).toHaveLength(1)
  })
})
