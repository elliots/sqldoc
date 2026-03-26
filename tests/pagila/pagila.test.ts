import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgDump } from "@electric-sql/pglite-tools/pg_dump";
import { createDockerAdapter, createPgliteAdapter, createRunner } from "@sqldoc/db";

const rawPagilaSQL = fs.readFileSync(
  path.join(__dirname, "pagila-schema.sql"),
  "utf-8",
);
// pg_dump output uses OWNER TO postgres — ensure the role exists
const pagilaSQL =
  `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres SUPERUSER; END IF; END $$;\n` +
  rawPagilaSQL;

// loop through postgres versions and pglite
["postgres:17", "postgres:15", "postgres:14", undefined].forEach((version) => {
  describe("pagila schema", async () => {
    const devUrl = version ? `docker://${version}` : undefined;
    const testTitle = version ?? "pglite";

    const runner = await createRunner({
      dialect: "postgres",
      devUrl,
    });

    it(`${testTitle}: self-diff produces zero changes`, async () => {
      const result = await runner.diff([pagilaSQL], [pagilaSQL]);
      expect(result.error).toBeUndefined();
      const stmts = result.statements ?? [];
      if (stmts.length > 0) console.log("Self-diff statements:", stmts);
      expect(stmts).toHaveLength(0);
    }, 120_000);

    it(`${testTitle}: inspect returns expected tables`, async () => {
      const result = await runner.inspect([pagilaSQL]);
      expect(result.error).toBeUndefined();
      expect(result.schema).toBeDefined();

      const tables = result.schema!.schemas.flatMap((s) => s.tables ?? []);
      expect(tables.length).toBeGreaterThanOrEqual(15);

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("actor");
      expect(tableNames).toContain("film");
      expect(tableNames).toContain("customer");
      expect(tableNames).toContain("rental");
    }, 120_000);

    it(`${testTitle}: live DB diff against original SQL produces zero changes`, async () => {
      const liveDb = devUrl ? await createDockerAdapter(devUrl) : await createPgliteAdapter();
      try {
        await liveDb.exec(pagilaSQL); // execute original SQL directly

        const result = await runner.diff(liveDb, [pagilaSQL]);
        expect(result.error).toBeUndefined();
        const stmts = result.statements ?? [];
        if (stmts.length > 0) console.log("Live DB diff statements:", stmts);
        expect(stmts).toHaveLength(0);
      } finally {
        await liveDb.close();
      }
    }, 120_000);

    it(`${testTitle}: empty-to-schema migration round-trips correctly`, async () => {
      const migrationResult = await runner.diff([], [pagilaSQL]);
      expect(migrationResult.error).toBeUndefined();
      expect(migrationResult.statements).toBeDefined();
      expect(migrationResult.statements!.length).toBeGreaterThan(0);

      const migrationSQL = migrationResult.statements!.join(";\n") + ";";

      const result = await runner.diff([migrationSQL], [pagilaSQL]);
      expect(result.error).toBeUndefined();
      const stmts = result.statements ?? [];
      if (stmts.length > 0)
        console.log("Migration round-trip statements:", stmts);
      expect(stmts).toHaveLength(0);
      
      if (!version) {
        // for pglite, also test applying the migration, dumping via pg_dump, then diffing against original SQL
        const pg = await PGlite.create();
        try {
          await pg.exec(migrationSQL);
          const dump = await pgDump({ pg });
          const dumpSQL = await dump.text();
          expect(dumpSQL.length).toBeGreaterThan(0);

          const reDiffResult = await runner.diff([dumpSQL], [pagilaSQL]);
          expect(reDiffResult.error).toBeUndefined();
          const reDiffStmts = reDiffResult.statements ?? [];
          if (reDiffStmts.length > 0)
            console.log("Re-diff statements:", reDiffStmts);
          expect(reDiffStmts).toHaveLength(0);
        } finally {
          await pg.close();
        }
      }
    }, 120_000);

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
    `;

      const result = await runner.diff([pagilaSQL], [altered]);
      expect(result.error).toBeUndefined();

      expect(result.changes).toMatchObject([
        {
          type: "add_column",
          table: "actor",
          name: "nickname",
          detail: "character varying",
        },
        { type: "add_table", table: "reviews" },
        { type: "add_index", table: "reviews", name: "idx_reviews_film" },
      ]);

      expect(result.statements).toBeDefined();
      expect(result.statements!.length).toBe(3);

      // console.log("Alteration diff statements:", result.statements);
      // console.log("Alteration diff changes:", result.changes);

      expect(result.statements![0]).toContain('ADD COLUMN "nickname"');
      expect(result.statements![1]).toContain(
        'CREATE TABLE "public"."reviews"',
      );
      expect(result.statements![2]).toContain(
        'CREATE INDEX "idx_reviews_film"',
      );

      const recheck = await runner.diff([altered], [altered]);
      expect(recheck.error).toBeUndefined();
      expect(recheck.statements ?? []).toHaveLength(0);
    }, 120_000);
  });
});
