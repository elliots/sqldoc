import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createDockerAdapter, createPgliteAdapter, createRunner, extractExtensions } from "@sqldoc/db";

const kitchenSinkSQL = fs.readFileSync(
  path.join(__dirname, "kitchen-sink-schema.sql"),
  "utf-8",
);

const extensions = extractExtensions([kitchenSinkSQL]).extensions;

// Kitchen sink uses multiple schemas (a, b, c, d, etc.), extensions (tablefunc, hstore, intarray),
// and starts with DROP CASCADE.
["postgres:17", "postgres:16", "postgres:15", "postgres:14", undefined].forEach((version) => {
  describe("postgraphile kitchen-sink schema", async () => {

    const devUrl = version ? `docker://${version}` : undefined;
    const testTitle = version ?? "pglite";

    const runner = await createRunner({
      dialect: "postgres",
      devUrl,
      extensions,
    });

    it(`${testTitle}: self-diff produces zero changes`, async () => {
      const result = await runner.diff([kitchenSinkSQL], [kitchenSinkSQL]);
      expect(result.error).toBeUndefined();
      const stmts = result.statements ?? [];
      if (stmts.length > 0) console.log("Self-diff statements:", stmts);
      expect(stmts).toHaveLength(0);
    }, 120_000);

    it(`${testTitle}: inspect returns expected schemas and tables`, async () => {
      const result = await runner.inspect([kitchenSinkSQL]);
      expect(result.error).toBeUndefined();
      expect(result.schema).toBeDefined();

      const schemaNames = result.schema!.schemas.map((s) => s.name);
      expect(schemaNames).toContain("a");
      expect(schemaNames).toContain("b");
      expect(schemaNames).toContain("c");
      expect(schemaNames).toContain("d");

      const tables = result.schema!.schemas.flatMap((s) => s.tables ?? []);
      expect(tables.length).toBeGreaterThanOrEqual(40);
    }, 120_000);

    it(`${testTitle}: live DB diff against original SQL produces zero changes`, async () => {
      const liveDb = devUrl ? await createDockerAdapter(devUrl) : await createPgliteAdapter(extensions);
      try {
        await liveDb.exec(kitchenSinkSQL);

        const result = await runner.diff(liveDb, [kitchenSinkSQL]);
        expect(result.error).toBeUndefined();
        const stmts = result.statements ?? [];
        if (stmts.length > 0) console.log("Live DB diff statements:", stmts);
        expect(stmts).toHaveLength(0);
      } finally {
        await liveDb.close();
      }
    }, 120_000);

    it(`${testTitle}: empty-to-schema migration round-trips correctly`, async () => {
      const migrationResult = await runner.diff([], [kitchenSinkSQL]);
      expect(migrationResult.error).toBeUndefined();
      expect(migrationResult.statements).toBeDefined();
      expect(migrationResult.statements!.length).toBeGreaterThan(0);

      const migrationSQL = migrationResult.statements!.join(";\n") + ";";

      const result = await runner.diff([migrationSQL], [kitchenSinkSQL]);
      expect(result.error).toBeUndefined();
      const stmts = result.statements ?? [];
      if (stmts.length > 0)
        console.log("Migration round-trip statements:", stmts);
      expect(stmts).toHaveLength(0);
    }, 120_000);

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
      `;

      const result = await runner.diff([kitchenSinkSQL], [altered]);
      expect(result.error).toBeUndefined();

      expect(result.changes).toMatchObject([
        { type: "add_column", table: "post", name: "slug", detail: "text" },
        { type: "add_table", table: "tags", detail: "id, name" },
        { type: "add_index", table: "tags", name: "idx_tags_name" },
        { type: "add_index", table: "tags", name: "tags_name_key" },
      ]);

      expect(result.statements).toBeDefined();
      expect(result.statements!.length).toBe(3);

      expect(result.statements![0]).toContain('ADD COLUMN "slug"');
      expect(result.statements![1]).toContain('CREATE TABLE "a"."tags"');
      expect(result.statements![2]).toContain('CREATE INDEX "idx_tags_name"');

      const recheck = await runner.diff([altered], [altered]);
      expect(recheck.error).toBeUndefined();
      expect(recheck.statements ?? []).toHaveLength(0);
    }, 120_000);
  });
});
