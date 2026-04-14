/**
 * Integration tests for ns-validate.
 *
 * Generates CHECK constraint SQL, executes against real databases,
 * then verifies valid data is accepted and invalid data is rejected.
 * Supports Postgres and MySQL (SQLite returns docs-only).
 */

import { makeTagCtx } from '@sqldoc/core/test'
import { createAdapter, type DatabaseAdapter } from '@sqldoc/db'
import { after, describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

function getConstraintSql(
  dialect: 'postgres' | 'mysql',
  objectName: string,
  columnName: string,
  tagName: string,
  args: Record<string, unknown> | unknown[],
): string[] {
  const result = plugin.onTag!(
    makeTagCtx({
      dialect,
      objectName,
      target: 'column',
      columnName,
      tag: { name: tagName, args },
    }),
  ) as any
  return result?.sql?.map((s: any) => s.sql) ?? []
}

// -- Postgres --

describe('ns-validate integration - Postgres', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('range constraint rejects out-of-range values', async () => {
    db = await createAdapter({ engine: 'postgres' })
    await db.exec('CREATE TABLE products (id SERIAL PRIMARY KEY, name TEXT NOT NULL, price NUMERIC, age INTEGER)')

    // Add range constraint on age: 0-120
    for (const sql of getConstraintSql('postgres', 'products', 'age', 'range', { min: 0, max: 120 })) {
      await db.exec(sql)
    }

    // Valid value accepted
    await db.exec("INSERT INTO products (name, price, age) VALUES ('Valid', 10, 30)")
    const valid = await db.query("SELECT name FROM products WHERE name = 'Valid'")
    expect(valid.rows).toHaveLength(1)

    // Out of range rejected
    let rejected = false
    try {
      await db.exec("INSERT INTO products (name, price, age) VALUES ('TooOld', 10, 200)")
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)
  })

  it('notEmpty constraint rejects empty strings', async () => {
    for (const sql of getConstraintSql('postgres', 'products', 'name', 'notEmpty', {})) {
      await db.exec(sql)
    }

    let rejected = false
    try {
      await db.exec("INSERT INTO products (name, price) VALUES ('', 10)")
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)

    // Non-empty accepted
    await db.exec("INSERT INTO products (name, price) VALUES ('Widget', 10)")
    const valid = await db.query("SELECT name FROM products WHERE name = 'Widget'")
    expect(valid.rows).toHaveLength(1)
  })

  it('pattern constraint rejects non-matching values', async () => {
    await db.exec('CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL)')

    for (const sql of getConstraintSql('postgres', 'users', 'email', 'pattern', ['.+@.+\\..+'])) {
      await db.exec(sql)
    }

    // Valid email accepted
    await db.exec("INSERT INTO users (email) VALUES ('user@example.com')")

    // Invalid email rejected
    let rejected = false
    try {
      await db.exec("INSERT INTO users (email) VALUES ('not-an-email')")
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)
  })
})

// -- MySQL --

describe('ns-validate integration - MySQL', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('range constraint rejects out-of-range values', async () => {
    db = await createAdapter({ engine: 'mysql' })
    await db.exec('CREATE TABLE items (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, score INT)')

    for (const sql of getConstraintSql('mysql', 'items', 'score', 'range', { min: 1, max: 100 })) {
      await db.exec(sql)
    }

    // Valid value accepted
    await db.exec("INSERT INTO items (name, score) VALUES ('Good', 50)")
    const valid = await db.query("SELECT name FROM items WHERE name = 'Good'")
    expect(valid.rows).toHaveLength(1)

    // Out of range rejected
    let rejected = false
    try {
      await db.exec("INSERT INTO items (name, score) VALUES ('Bad', 999)")
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)
  })

  it('notEmpty constraint rejects empty strings', async () => {
    for (const sql of getConstraintSql('mysql', 'items', 'name', 'notEmpty', {})) {
      await db.exec(sql)
    }

    let rejected = false
    try {
      await db.exec("INSERT INTO items (name, score) VALUES ('', 50)")
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)
  })
})
