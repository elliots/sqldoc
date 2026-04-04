import * as fs from 'node:fs'
import * as path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgDump } from '@electric-sql/pglite-tools/pg_dump'
import { createPgliteAdapter, createPostgresDockerAdapter, createRunner } from '@sqldoc/db'
import { after, before, describe, expect, it } from '@sqldoc/test-utils'
import { prettyStatements } from '../../packages/cli/src/utils/pretty-sql.ts'

const rawPagilaSQL = fs.readFileSync(path.join(import.meta.dirname, 'pagila-schema.sql'), 'utf-8')
// pg_dump output uses OWNER TO postgres — ensure the role exists
const pagilaSQL =
  `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres SUPERUSER; END IF; END $$;\n` +
  rawPagilaSQL

// loop through postgres versions and pglite
;['postgres:17', 'postgres:16', 'postgres:15', 'postgres:14', undefined].forEach((version) => {
  describe(`pagila schema - ${version ?? 'pglite'}`, { timeout: 120_000 }, () => {
    const devUrl = version ? `docker://${version}` : undefined
    const testTitle = version ?? 'pglite'
    let runner: ReturnType<typeof createRunner> extends Promise<infer T> ? T : never

    before(async () => {
      runner = await createRunner({
        dialect: 'postgres',
        devUrl,
      })
    })

    after(async () => {
      await runner?.close()
    })

    it(`${testTitle}: self-diff produces zero changes`, async () => {
      const result = await runner.diff([pagilaSQL], [pagilaSQL])
      expect(result.error).toBe(undefined)
      const stmts = result.statements ?? []
      if (stmts.length > 0) console.log('Self-diff statements:', stmts)
      expect(stmts).toHaveLength(0)
    })

    it(`${testTitle}: inspect returns expected tables`, async () => {
      const result = await runner.inspect([pagilaSQL])
      expect(result.error).toBe(undefined)
      expect(result.schema).not.toBe(undefined)

      const tables = result.schema!.schemas.flatMap((s) => s.tables ?? [])
      expect(tables.length >= 15).toBeTruthy()

      const tableNames = tables.map((t) => t.name)
      expect(tableNames).toContain('actor')
      expect(tableNames).toContain('film')
      expect(tableNames).toContain('customer')
      expect(tableNames).toContain('rental')
    })

    it(`${testTitle}: live DB diff against original SQL produces zero changes`, async () => {
      const liveDb = devUrl ? await createPostgresDockerAdapter(devUrl) : await createPgliteAdapter()
      try {
        await liveDb.exec(pagilaSQL) // execute original SQL directly

        const result = await runner.diff(liveDb, [pagilaSQL])
        expect(result.error).toBe(undefined)
        const stmts = result.statements ?? []
        if (stmts.length > 0) console.log('Live DB diff statements:', stmts)
        expect(stmts).toHaveLength(0)
      } finally {
        await liveDb.close()
      }
    })

    it(`${testTitle}: empty-to-schema migration round-trips correctly`, async () => {
      const migrationResult = await runner.diff([], [pagilaSQL])
      expect(migrationResult.error).toBe(undefined)
      expect(migrationResult.statements).not.toBe(undefined)
      expect(migrationResult.statements!.length > 0).toBeTruthy()

      const migrationSQL = `${migrationResult.statements!.join(';\n')};`

      const result = await runner.diff([migrationSQL], [pagilaSQL])
      expect(result.error).toBe(undefined)
      const stmts = result.statements ?? []
      if (stmts.length > 0) console.log('Migration round-trip statements:', stmts)
      expect(stmts).toHaveLength(0)

      if (!version) {
        // for pglite, also test applying the migration, dumping via pg_dump, then diffing against original SQL
        const pg = await PGlite.create()
        try {
          await pg.exec(migrationSQL)
          const dump = await pgDump({ pg })
          const dumpSQL = await dump.text()
          expect(dumpSQL.length > 0).toBeTruthy()

          const reDiffResult = await runner.diff([dumpSQL], [pagilaSQL])
          expect(reDiffResult.error).toBe(undefined)
          const reDiffStmts = reDiffResult.statements ?? []
          if (reDiffStmts.length > 0) console.log('Re-diff statements:', reDiffStmts)
          expect(reDiffStmts).toHaveLength(0)
        } finally {
          await pg.close()
        }
      }
    })

    it(`${testTitle}: pretty-formatted migration round-trips correctly`, async () => {
      const migrationResult = await runner.diff([], [pagilaSQL])
      expect(migrationResult.error).toBe(undefined)
      const stmts = migrationResult.statements!
      expect(stmts.length > 0).toBeTruthy()

      const prettySQL = prettyStatements(stmts, true)

      const result = await runner.diff([prettySQL], [pagilaSQL])
      expect(result.error).toBe(undefined)
      const diffStmts = result.statements ?? []
      if (diffStmts.length > 0) console.log('Pretty round-trip diff statements:', diffStmts)
      expect(diffStmts).toHaveLength(0)
    })

    it(`${testTitle}: detects schema alteration correctly`, async () => {
      const altered =
        pagilaSQL +
        `
      alter table public.actor add column nickname VARCHAR(100);
      create table public.reviews (
        id bigserial primary key,
        film_id integer references public.film(film_id),
        rating integer not null,
        body text
      );
      create index idx_reviews_film on public.reviews(film_id);
    `

      const result = await runner.diff([pagilaSQL], [altered])
      expect(result.error).toBe(undefined)

      expect(result.changes).toEqual([
        {
          type: 'add_column',
          table: 'actor',
          name: 'nickname',
          detail: 'character varying',
        },
        { type: 'add_table', table: 'reviews', detail: 'id, film_id, rating, body' },
        { type: 'add_index', table: 'reviews', name: 'idx_reviews_film' },
      ])

      expect(result.statements).not.toBe(undefined)
      expect(result.statements!).toHaveLength(3)

      expect(result.statements![0]).toContain('ADD COLUMN "nickname"')
      expect(result.statements![1]).toContain('CREATE TABLE "public"."reviews"')
      expect(result.statements![2]).toContain('CREATE INDEX "idx_reviews_film"')

      const recheck = await runner.diff([altered], [altered])
      expect(recheck.error).toBe(undefined)
      expect(recheck.statements ?? []).toHaveLength(0)
    })
  })
})
