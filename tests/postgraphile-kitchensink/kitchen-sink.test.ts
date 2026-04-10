import * as fs from 'node:fs'
import * as path from 'node:path'
import { createPostgresDockerAdapter, createRunner, extractExtensions, registerBuiltin } from '@sqldoc/db'
import neonTemporaryPlugin from '@sqldoc/db-neon-temporary'
import pglitePlugin from '@sqldoc/db-pglite'

import { after, before, describe, expect, it } from '@sqldoc/test-utils'
import { prettyStatements } from '../../packages/cli/src/utils/pretty-sql.ts'

const kitchenSinkSQL = fs.readFileSync(path.join(import.meta.dirname, 'kitchen-sink-schema.sql'), 'utf-8')

const extensions = extractExtensions([kitchenSinkSQL]).extensions

// Kitchen sink uses multiple schemas (a, b, c, d, etc.), extensions (tablefunc, hstore, intarray),
// and starts with DROP CASCADE.
const versions: Array<string | undefined> = ['postgres:17', 'postgres:16', 'postgres:15', 'postgres:14', undefined]

if (process.env.TEST_NEON_ONLY === 'true') {
  versions.length = 0
}

if (process.env.TEST_NEON === 'true' || process.env.TEST_NEON_ONLY === 'true') {
  versions.push('neon-temporary')
  registerBuiltin(neonTemporaryPlugin)
}

versions.forEach((version) => {
  const timeout = version === 'neon-temporary' ? 600_000 : 120_000
  describe(`postgraphile kitchen-sink schema - ${version ?? 'pglite'}`, { timeout }, () => {
    const devUrl = version === 'neon-temporary' ? 'neon-temporary' : version ? `docker://${version}` : undefined
    const testTitle = version ?? 'pglite'
    let runner: ReturnType<typeof createRunner> extends Promise<infer T> ? T : never

    before(async () => {
      runner = await createRunner({
        dialect: 'postgres',
        devUrl,
        extensions,
      })
    })

    after(async () => {
      await runner?.close()
    })

    it(`${testTitle}: self-diff produces zero changes`, async () => {
      const result = await runner.diff([kitchenSinkSQL], [kitchenSinkSQL])
      expect(result.error).toBe(undefined)
      const stmts = result.statements ?? []
      if (stmts.length > 0) console.log('Self-diff statements:', stmts)
      expect(stmts).toHaveLength(0)
    })

    it(`${testTitle}: inspect returns expected schemas and tables`, async () => {
      const result = await runner.inspect([kitchenSinkSQL])
      expect(result.error).toBe(undefined)
      expect(result.schema).not.toBe(undefined)

      const schemaNames = result.schema!.schemas.map((s) => s.name)
      expect(schemaNames).toContain('a')
      expect(schemaNames).toContain('b')
      expect(schemaNames).toContain('c')
      expect(schemaNames).toContain('d')

      const tables = result.schema!.schemas.flatMap((s) => s.tables ?? [])
      expect(tables.length >= 40).toBeTruthy()
    })

    // neon-temporary: runner's dev DB and live DB share the same Neon database,
    // so a second createAdapter() deadlocks on the advisory lock.
    const liveIt = devUrl === 'neon-temporary' ? it.skip : it
    liveIt(`${testTitle}: live DB diff against original SQL produces zero changes`, async () => {
      const liveDb = devUrl
        ? await createPostgresDockerAdapter(devUrl)
        : await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions })
      try {
        await liveDb.exec(kitchenSinkSQL)

        const result = await runner.diff(liveDb, [kitchenSinkSQL])
        expect(result.error).toBe(undefined)
        const stmts = result.statements ?? []
        if (stmts.length > 0) console.log('Live DB diff statements:', stmts)
        expect(stmts).toHaveLength(0)
      } finally {
        await liveDb.close()
      }
    })

    it(`${testTitle}: empty-to-schema migration round-trips correctly`, async () => {
      const migrationResult = await runner.diff([], [kitchenSinkSQL])
      expect(migrationResult.error).toBe(undefined)
      expect(migrationResult.statements).not.toBe(undefined)
      expect(migrationResult.statements!.length > 0).toBeTruthy()

      const migrationSQL = `${migrationResult.statements!.join(';\n')};`

      const result = await runner.diff([migrationSQL], [kitchenSinkSQL])
      expect(result.error).toBe(undefined)
      const stmts = result.statements ?? []
      if (stmts.length > 0) console.log('Migration round-trip statements:', stmts)
      expect(stmts).toHaveLength(0)
    })

    it(`${testTitle}: pretty-formatted migration round-trips correctly`, async () => {
      const migrationResult = await runner.diff([], [kitchenSinkSQL])
      expect(migrationResult.error).toBe(undefined)
      const stmts = migrationResult.statements!
      expect(stmts.length > 0).toBeTruthy()

      const prettySQL = prettyStatements(stmts, true)

      const result = await runner.diff([prettySQL], [kitchenSinkSQL])
      expect(result.error).toBe(undefined)
      const diffStmts = result.statements ?? []
      if (diffStmts.length > 0) console.log('Pretty round-trip diff statements:', diffStmts)
      expect(diffStmts).toHaveLength(0)
    })

    it(`${testTitle}: detects schema alteration correctly`, async () => {
      const altered =
        kitchenSinkSQL +
        `
        alter table a.post add column slug text;
        create table a.tags (
          id serial primary key,
          name text not null unique
        );
        create index idx_tags_name on a.tags(name);
      `

      const result = await runner.diff([kitchenSinkSQL], [altered])
      expect(result.error).toBe(undefined)

      // Verify change types (rich Change format)
      const changeTypes = result.changes!.map((c) => c.type)
      expect(changeTypes).toContain('modify_table')
      expect(changeTypes).toContain('add_table')

      // Verify modify_table adds slug column
      const modifyPost = result.changes!.find((c) => c.type === 'modify_table' && (c as any).T?.name === 'post')
      expect(modifyPost).not.toBe(undefined)
      const addSlug = (modifyPost as any).changes?.find((c: any) => c.type === 'add_column')
      expect(addSlug?.C?.name).toBe('slug')

      // Verify add_table creates tags
      const addTags = result.changes!.find((c) => c.type === 'add_table' && (c as any).T?.name === 'tags')
      expect(addTags).not.toBe(undefined)

      expect(result.statements).not.toBe(undefined)
      expect(result.statements!.length).toBeGreaterThanOrEqual(3)

      expect(result.statements!.some((s) => s.includes('ADD COLUMN "slug"'))).toBe(true)
      expect(result.statements!.some((s) => s.includes('CREATE TABLE "a"."tags"'))).toBe(true)
      expect(result.statements!.some((s) => s.includes('CREATE INDEX "idx_tags_name"'))).toBe(true)

      const recheck = await runner.diff([altered], [altered])
      expect(recheck.error).toBe(undefined)
      expect(recheck.statements ?? []).toHaveLength(0)
    })
  })
})
