import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createDockerAdapter, createRunner } from "@sqldoc/db";

const rawPagilaSQL = fs.readFileSync(
  path.join(__dirname, "pagila-schema.sql"),
  "utf-8",
);
// pg_dump output uses OWNER TO postgres — ensure the role exists
const pagilaSQL =
  `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres SUPERUSER; END IF; END $$;\n` +
  rawPagilaSQL;

describe("pagila schema round-trip", () => {
  it("self-diff produces zero changes", async () => {
    const runner = await createRunner({
      dialect: "postgres",
      devUrl: "docker://postgres:16",
    });
    try {
      const result = await runner.diff([pagilaSQL], [pagilaSQL], {
        dialect: "postgres",
      });
      expect(result.error).toBeUndefined();
      const stmts = result.statements ?? [];
      if (stmts.length > 0) console.log("Self-diff statements:", stmts);
      expect(stmts).toHaveLength(0);
    } finally {
      await runner.close();
    }
  }, 120_000);

  it("inspect returns expected tables", async () => {
    const runner = await createRunner({
      dialect: "postgres",
      devUrl: "docker://postgres:16",
    });
    try {
      const result = await runner.inspect([pagilaSQL], {
        dialect: "postgres",
      });
      expect(result.error).toBeUndefined();
      expect(result.schema).toBeDefined();

      const tables = result.schema!.schemas.flatMap((s) => s.tables ?? []);
      expect(tables.length).toBeGreaterThanOrEqual(15);

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("actor");
      expect(tableNames).toContain("film");
      expect(tableNames).toContain("customer");
      expect(tableNames).toContain("rental");
    } finally {
      await runner.close();
    }
  }, 120_000);

  it("live DB diff against same SQL produces zero changes", async () => {
    const runner = await createRunner({
      dialect: "postgres",
      devUrl: "docker://postgres:16",
    });
    const liveDb = await createDockerAdapter("docker://postgres:16");
    try {
      await liveDb.exec(pagilaSQL);

      const result = await runner.diff([], [pagilaSQL], {
        dialect: "postgres",
        fromDb: liveDb,
      });
      expect(result.error).toBeUndefined();
      const stmts = result.statements ?? [];
      if (stmts.length > 0) console.log("Live DB diff statements:", stmts);
      expect(stmts).toHaveLength(0);
    } finally {
      await liveDb.close();
      await runner.close();
    }
  }, 120_000);

  it("empty-to-schema migration round-trips correctly", async () => {
    const runner = await createRunner({
      dialect: "postgres",
      devUrl: "docker://postgres:16",
    });
    try {
      const migrationResult = await runner.diff([], [pagilaSQL], {
        dialect: "postgres",
      });
      expect(migrationResult.error).toBeUndefined();
      expect(migrationResult.statements).toBeDefined();
      expect(migrationResult.statements!.length).toBeGreaterThan(0);

      const migrationSQL = migrationResult.statements!.join(";\n") + ";";

      const result = await runner.diff([migrationSQL], [pagilaSQL], {
        dialect: "postgres",
      });
      expect(result.error).toBeUndefined();
      const stmts = result.statements ?? [];
      if (stmts.length > 0)
        console.log("Migration round-trip statements:", stmts);
      expect(stmts).toHaveLength(0);
    } finally {
      await runner.close();
    }
  }, 120_000);

  it("detects schema alteration correctly", async () => {
    const runner = await createRunner({
      dialect: "postgres",
      devUrl: "docker://postgres:16",
    });
    try {
      const altered =
        pagilaSQL +
        `
      ALTER TABLE public.actor ADD COLUMN nickname VARCHAR(100);
      CREATE TABLE public.reviews (
        id BIGSERIAL PRIMARY KEY,
        film_id INTEGER REFERENCES public.film(film_id),
        rating INTEGER NOT NULL,
        body TEXT
      );
      CREATE INDEX idx_reviews_film ON public.reviews(film_id);
    `;

      const result = await runner.diff([pagilaSQL], [altered], {
        dialect: "postgres",
      });
      expect(result.error).toBeUndefined();
      
      expect(result.changes).toMatchObject([
        {
          type: "add_column",
          table: "actor",
          name: "nickname",
          detail: "character varying",
        },
        { type: "add_table", table: "reviews" },
      ]);

      expect(result.statements).toBeDefined();
      expect(result.statements!.length).toBeGreaterThan(0);

      const allSQL = result.statements!.join("\n").toUpperCase();
      expect(allSQL).toContain("NICKNAME");
      expect(allSQL).toContain("REVIEWS");

      const recheck = await runner.diff([altered], [altered], {
        dialect: "postgres",
      });
      expect(recheck.error).toBeUndefined();
      expect(recheck.statements ?? []).toHaveLength(0);
    } finally {
      await runner.close();
    }
  }, 120_000);
});
