/**
 * Sakila MSSQL round-trip schema test.
 *
 * Exercises the MSSQL dialect with a full DVD rental database schema.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRunner } from '@sqldoc/db'
import mssqlPlugin from '@sqldoc/db-mssql'
import { after, before, describe, expect, it } from '@sqldoc/test-utils'

const sakilaSQL = fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf-8')

const devUrl = 'docker://mcr.microsoft.com/mssql/server:2022-latest'

describe('sakila schema - mssql', { timeout: 180_000 }, () => {
  let runner: ReturnType<typeof createRunner> extends Promise<infer T> ? T : never

  before(async () => {
    runner = await createRunner({
      dialect: 'mssql',
      devUrl,
      adapterPlugin: mssqlPlugin,
    })
  })

  after(async () => {
    await runner?.close()
  })

  it('self-diff produces zero changes', async () => {
    const result = await runner.diff([sakilaSQL], [sakilaSQL])
    expect(result.error).toBe(undefined)
    const stmts = result.statements ?? []
    if (stmts.length > 0) console.log('Self-diff statements:', stmts)
    expect(stmts).toHaveLength(0)
  })

  it('inspect returns expected tables', async () => {
    const result = await runner.inspect([sakilaSQL])
    expect(result.error).toBe(undefined)
    expect(result.schema).not.toBe(undefined)

    const tables = result.schema!.schemas.flatMap((s) => s.tables ?? [])
    expect(tables.length >= 15).toBeTruthy()

    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain('actor')
    expect(tableNames).toContain('film')
    expect(tableNames).toContain('customer')
    expect(tableNames).toContain('rental')
    expect(tableNames).toContain('payment')
    expect(tableNames).toContain('inventory')
    expect(tableNames).toContain('store')
    expect(tableNames).toContain('staff')
  })

  it('empty-to-schema migration round-trips correctly', async () => {
    const migrationResult = await runner.diff([], [sakilaSQL])
    expect(migrationResult.error).toBe(undefined)
    expect(migrationResult.statements).not.toBe(undefined)
    expect(migrationResult.statements!.length > 0).toBeTruthy()

    const migrationSQL = `${migrationResult.statements!.join(';\n')};`

    const result = await runner.diff([migrationSQL], [sakilaSQL])
    expect(result.error).toBe(undefined)
    const stmts = result.statements ?? []
    if (stmts.length > 0) console.log('Migration round-trip statements:', stmts)
    expect(stmts).toHaveLength(0)
  })

  it('detects schema alteration correctly', async () => {
    const altered =
      sakilaSQL +
      `
      ALTER TABLE actor ADD middle_name NVARCHAR(45);
      CREATE TABLE review (
        review_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        film_id INT NOT NULL,
        customer_id INT NOT NULL,
        rating TINYINT NOT NULL,
        review_text NVARCHAR(MAX),
        created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_review_film FOREIGN KEY (film_id) REFERENCES film (film_id),
        CONSTRAINT FK_review_customer FOREIGN KEY (customer_id) REFERENCES customer (customer_id),
        CONSTRAINT CK_review_rating CHECK (rating BETWEEN 1 AND 5)
      );
      CREATE NONCLUSTERED INDEX IX_review_film_id ON review (film_id);
    `

    const result = await runner.diff([sakilaSQL], [altered])
    expect(result.error).toBe(undefined)

    expect(result.changes).not.toBe(undefined)
    const changeTypes = result.changes!.map((c: any) => c.type)
    expect(changeTypes).toContain('modify_table')
    expect(changeTypes).toContain('add_table')

    expect(result.statements).not.toBe(undefined)
    expect(result.statements!.length).toBeGreaterThanOrEqual(3)

    const recheck = await runner.diff([altered], [altered])
    expect(recheck.error).toBe(undefined)
    expect(recheck.statements ?? []).toHaveLength(0)
  })
})
