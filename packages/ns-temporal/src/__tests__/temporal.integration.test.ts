/**
 * Integration tests for ns-temporal.
 *
 * Generates SQL via the plugin, executes it against real databases,
 * inserts/updates/deletes data, then verifies temporal versioning works correctly.
 *
 * Postgres: full trigger support (INSERT/UPDATE/DELETE).
 * MySQL: INSERT trigger only (self-referential triggers not supported).
 * SQLite: not supported (can't ALTER TABLE PK or add NOT NULL expression defaults).
 */

import { makeTagCtx } from '@sqldoc/core/test'
import { createAdapter, type DatabaseAdapter } from '@sqldoc/db'
import { after, describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

function getSql(
  dialect: 'postgres' | 'mysql',
  objectName: string,
  columns: Array<{ name: string; type: { T: string } }>,
  pkColumns: string[],
): string[] {
  const result = plugin.onTag!(
    makeTagCtx({
      dialect,
      objectName,
      tag: { name: null, args: {} },
      atlasTable: { name: objectName, columns, primary_key: { columns: pkColumns } },
    }),
  ) as any
  return result?.sql?.map((s: any) => s.sql) ?? []
}

const columns = [
  { name: 'id', type: { T: 'integer' } },
  { name: 'name', type: { T: 'text' } },
  { name: 'price', type: { T: 'numeric' } },
]

// -- Postgres --

describe('ns-temporal integration - Postgres', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('INSERT sets valid_from, current view works', async () => {
    db = await createAdapter({ dialect: 'postgres' })
    await db.exec('CREATE TABLE products (id SERIAL PRIMARY KEY, name TEXT NOT NULL, price NUMERIC)')

    for (const sql of getSql('postgres', 'products', columns, ['id'])) await db.exec(sql)

    await db.exec("INSERT INTO products (name, price) VALUES ('Widget', 9.99)")

    const row = await db.query(
      "SELECT name, valid_from, valid_to FROM products WHERE name = 'Widget' AND valid_to IS NULL",
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0][1]).not.toBeNull()
    expect(row.rows[0][2]).toBeNull()

    const current = await db.query('SELECT name FROM products_current')
    expect(current.rows).toHaveLength(1)
  })

  it('UPDATE archives old version and creates new version', async () => {
    await db.exec("UPDATE products SET price = 14.99 WHERE name = 'Widget' AND valid_to IS NULL")

    // Should have 2 rows: one archived (valid_to set), one current (valid_to NULL)
    const all = await db.query("SELECT price, valid_to FROM products WHERE name = 'Widget' ORDER BY version_id")
    expect(all.rows).toHaveLength(2)

    // Current view shows only the updated row
    const current = await db.query('SELECT price FROM products_current')
    expect(current.rows).toHaveLength(1)
    expect(Number(current.rows[0][0])).toBe(14.99)

    // One row has valid_to set (archived), one has NULL (current)
    const archived = await db.query("SELECT price FROM products WHERE name = 'Widget' AND valid_to IS NOT NULL")
    expect(archived.rows).toHaveLength(1)
    expect(Number(archived.rows[0][0])).toBe(9.99)
  })

  it('DELETE archives the row then removes the current version', async () => {
    await db.exec("DELETE FROM products WHERE name = 'Widget' AND valid_to IS NULL")

    // Current view should be empty
    const current = await db.query("SELECT name FROM products_current WHERE name = 'Widget'")
    expect(current.rows).toHaveLength(0)

    // Archived versions remain (from update + delete), all with valid_to set
    const archived = await db.query("SELECT name, valid_to FROM products WHERE name = 'Widget'")
    expect(archived.rows.length).toBeGreaterThanOrEqual(2)
    for (const row of archived.rows) {
      expect(row[1]).not.toBeNull()
    }
  })
})

// -- MySQL (INSERT trigger only) --

describe('ns-temporal integration - MySQL', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('INSERT sets valid_from, current view works', async () => {
    db = await createAdapter({ dialect: 'mysql' })
    await db.exec(
      'CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, price DECIMAL(10,2))',
    )

    const mysqlColumns = [
      { name: 'id', type: { T: 'int' } },
      { name: 'name', type: { T: 'varchar(255)' } },
      { name: 'price', type: { T: 'decimal(10,2)' } },
    ]
    for (const sql of getSql('mysql', 'orders', mysqlColumns, ['id'])) await db.exec(sql)

    await db.exec("INSERT INTO orders (name, price) VALUES ('Order1', 100.00)")

    const row = await db.query("SELECT name, valid_from, valid_to FROM orders WHERE name = 'Order1'")
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0][1]).not.toBeNull()
    expect(row.rows[0][2]).toBeNull()

    const current = await db.query('SELECT name FROM orders_current')
    expect(current.rows).toHaveLength(1)
    expect(current.rows[0][0]).toBe('Order1')
  })
})
