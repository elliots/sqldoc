/**
 * Regression test: `sqldoc migrate` fails when the schema uses a non-public
 * schema (e.g. CREATE SCHEMA core; CREATE TABLE core.migrations ...).
 *
 * PGlite starts with only the "public" schema. The user's SQL correctly
 * includes CREATE SCHEMA IF NOT EXISTS "core" before referencing core.* tables,
 * but executeFiles or the pipeline fails with:
 *
 *   relation "core.migrations" does not exist
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, initProject, it, runCli } from '@sqldoc/test-utils'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-migrate-nonpublic-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('migrate with non-public schema', () => {
  it('generates initial migration for tables in a custom schema', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  engine: 'postgres',
  schema: 'schema.sql',
  migrations: {
    dir: 'migrations',
    format: 'plain',
  },
}
`,
    )

    fs.mkdirSync(path.join(tmpDir, 'migrations'))

    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `CREATE SCHEMA IF NOT EXISTS "core";

CREATE TABLE "core"."tenants" (
  "id" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenants_pkey" PRIMARY KEY (id)
);

CREATE TABLE "core"."migrations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "module" text NOT NULL,
  "version" int4 NULL,
  "applied_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "migrations_pkey" PRIMARY KEY (id),
  CONSTRAINT "migrations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE
);
`,
    )

    runCli('migrate --name init', tmpDir)

    const files = fs.readdirSync(path.join(tmpDir, 'migrations')).filter((f) => f.endsWith('.sql'))
    expect(files).toHaveLength(1)

    const content = fs.readFileSync(path.join(tmpDir, 'migrations', files[0]), 'utf-8')
    expect(content).toContain('CREATE SCHEMA')
    expect(content).toContain('core')
    expect(content).toContain('tenants')
    expect(content).toContain('migrations')
  })

  it('handles COMMENT ON CONSTRAINT with non-public schema tables', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  engine: 'postgres',
  schema: 'schema.sql',
  migrations: {
    dir: 'migrations',
    format: 'plain',
  },
}
`,
    )

    fs.mkdirSync(path.join(tmpDir, 'migrations'))

    // This reproduces a real-world schema where COMMENT ON CONSTRAINT
    // statements follow CREATE TABLE in a non-public schema
    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `
--- BEGIN ALTER TABLE "core"."migrations" ---

create schema if not exists "core";

--- BEGIN CREATE TABLE "core"."tenants" ---

CREATE TABLE "core"."tenants" (
	"id" text NOT NULL  ,
	"schema_name" text NOT NULL  ,
	"name" text NOT NULL DEFAULT ''::text ,
	"created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP ,
	CONSTRAINT "tenants_pkey" PRIMARY KEY (id)
);

COMMENT ON COLUMN "core"."tenants"."id"  IS NULL;
COMMENT ON COLUMN "core"."tenants"."schema_name"  IS NULL;
COMMENT ON COLUMN "core"."tenants"."name"  IS NULL;
COMMENT ON COLUMN "core"."tenants"."created_at"  IS NULL;
COMMENT ON CONSTRAINT "tenants_pkey" ON "core"."tenants" IS NULL;
COMMENT ON TABLE "core"."tenants"  IS NULL;

--- END CREATE TABLE "core"."tenants" ---

--- BEGIN CREATE TABLE "core"."migrations" ---

CREATE TABLE "core"."migrations" (
	"id" uuid NOT NULL DEFAULT gen_random_uuid() ,
	"tenant_id" text NOT NULL  ,
	"module" text NOT NULL  ,
	"version" int4 NULL  ,
	"filename" text NULL  ,
	"applied_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP ,
	CONSTRAINT "migrations_pkey" PRIMARY KEY (id) ,
	CONSTRAINT "migrations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMENT ON COLUMN "core"."migrations"."id"  IS NULL;
COMMENT ON COLUMN "core"."migrations"."tenant_id"  IS NULL;
COMMENT ON COLUMN "core"."migrations"."module"  IS NULL;
COMMENT ON COLUMN "core"."migrations"."version"  IS NULL;
COMMENT ON COLUMN "core"."migrations"."filename"  IS NULL;
COMMENT ON COLUMN "core"."migrations"."applied_at"  IS NULL;
COMMENT ON CONSTRAINT "migrations_pkey" ON "core"."migrations" IS NULL;
COMMENT ON CONSTRAINT "migrations_tenant_id_fkey" ON "core"."migrations" IS NULL;
COMMENT ON TABLE "core"."migrations"  IS NULL;

--- END CREATE TABLE "core"."migrations" ---

--- BEGIN CREATE TABLE "core"."schema_versions" ---

CREATE TABLE "core"."schema_versions" (
	"tenant_id" text NOT NULL  ,
	"module" text NOT NULL  ,
	"schema_hash" text NOT NULL  ,
	"applied_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP ,
	CONSTRAINT "schema_versions_pkey" PRIMARY KEY (tenant_id, module) ,
	CONSTRAINT "schema_versions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMENT ON COLUMN "core"."schema_versions"."tenant_id"  IS NULL;
COMMENT ON COLUMN "core"."schema_versions"."module"  IS NULL;
COMMENT ON COLUMN "core"."schema_versions"."schema_hash"  IS NULL;
COMMENT ON COLUMN "core"."schema_versions"."applied_at"  IS NULL;
COMMENT ON CONSTRAINT "schema_versions_pkey" ON "core"."schema_versions" IS NULL;
COMMENT ON CONSTRAINT "schema_versions_tenant_id_fkey" ON "core"."schema_versions" IS NULL;
COMMENT ON TABLE "core"."schema_versions"  IS NULL;

--- END CREATE TABLE "core"."schema_versions" ---

--- BEGIN CREATE FUNCTION "core"."set_updated_at"() ---

CREATE OR REPLACE FUNCTION core.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

COMMENT ON FUNCTION "core"."set_updated_at"()  IS NULL;

--- END CREATE FUNCTION "core"."set_updated_at"() ---

--- BEGIN ALTER TABLE "core"."migrations" ---

ALTER TABLE IF EXISTS "core"."migrations" DROP CONSTRAINT IF EXISTS "migrations_tenant_id_fkey";
ALTER TABLE IF EXISTS "core"."migrations" ADD CONSTRAINT "migrations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;
COMMENT ON CONSTRAINT "migrations_tenant_id_fkey" ON "core"."migrations" IS NULL;

--- END ALTER TABLE "core"."migrations" ---

--- BEGIN ALTER TABLE "core"."schema_versions" ---

ALTER TABLE IF EXISTS "core"."schema_versions" DROP CONSTRAINT IF EXISTS "schema_versions_tenant_id_fkey";
ALTER TABLE IF EXISTS "core"."schema_versions" ADD CONSTRAINT "schema_versions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;
COMMENT ON CONSTRAINT "schema_versions_tenant_id_fkey" ON "core"."schema_versions" IS NULL;

--- END ALTER TABLE "core"."schema_versions" ---
`,
    )

    runCli('migrate --name init', tmpDir)

    const files = fs.readdirSync(path.join(tmpDir, 'migrations')).filter((f) => f.endsWith('.sql'))
    expect(files).toHaveLength(1)

    const content = fs.readFileSync(path.join(tmpDir, 'migrations', files[0]), 'utf-8')
    expect(content).toContain('CREATE SCHEMA')
    expect(content).toContain('tenants')
    expect(content).toContain('migrations')
  })

  it('generates incremental migration with existing non-public schema migrations', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  engine: 'postgres',
  schema: 'schema.sql',
  migrations: {
    dir: 'migrations',
    format: 'plain',
  },
}
`,
    )

    const migrationsDir = path.join(tmpDir, 'migrations')
    fs.mkdirSync(migrationsDir)

    // Existing migration that created the schema and initial tables
    fs.writeFileSync(
      path.join(migrationsDir, '20260101000000_init.sql'),
      `CREATE SCHEMA IF NOT EXISTS "core";
CREATE TABLE "core"."tenants" ("id" text NOT NULL, "name" text NOT NULL DEFAULT '', CONSTRAINT "tenants_pkey" PRIMARY KEY ("id"));
CREATE TABLE "core"."migrations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" text NOT NULL, "module" text NOT NULL, "applied_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "migrations_pkey" PRIMARY KEY ("id"), CONSTRAINT "migrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON UPDATE CASCADE ON DELETE CASCADE);
`,
    )

    // Updated schema adds a column
    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `CREATE SCHEMA IF NOT EXISTS "core";

CREATE TABLE "core"."tenants" (
  "id" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenants_pkey" PRIMARY KEY (id)
);

CREATE TABLE "core"."migrations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "module" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "migrations_pkey" PRIMARY KEY (id),
  CONSTRAINT "migrations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE
);
`,
    )

    runCli('migrate --name add_created_at', tmpDir)

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    expect(files).toHaveLength(2)

    const content = fs.readFileSync(path.join(migrationsDir, files[1]), 'utf-8')
    expect(content).toContain('created_at')
  })

  it('handles schema inspect with non-public schema', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default { engine: 'postgres' }
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `CREATE SCHEMA IF NOT EXISTS "core";

CREATE TABLE "core"."tenants" (
  "id" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  CONSTRAINT "tenants_pkey" PRIMARY KEY (id)
);
`,
    )

    const result = runCli('schema inspect schema.sql --format json', tmpDir)
    const jsonStart = result.stdout.indexOf('{')
    expect(jsonStart >= 0).toBeTruthy()
    const schema = JSON.parse(result.stdout.slice(jsonStart))

    const coreSchema = schema.schemas.find((s: any) => s.name === 'core')
    expect(coreSchema).not.toBe(undefined)
    expect(coreSchema.tables.length).toBeGreaterThan(0)

    const tenants = coreSchema.tables.find((t: any) => t.name === 'tenants')
    expect(tenants).not.toBe(undefined)
  })
})
