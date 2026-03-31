/**
 * End-to-end workflow tests for sqldoc CLI commands.
 *
 * These tests simulate a real user experience by:
 * - Creating temp directories
 * - Running CLI commands via child_process
 * - Verifying output files and stdout/stderr
 *
 * Each test initializes a project with `sqldoc init --dev <monorepo>`
 * so that workspace packages are symlinked into .sqldoc/node_modules/.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  initProject,
  it,
  MONOREPO_ROOT,
  runCli,
  runShim,
} from '@sqldoc/test-utils'

// -- Test suite --

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-e2e-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// -- 1. Init test --

describe('init workflow', () => {
  it('creates .sqldoc/ directory structure with --dev flag', () => {
    initProject(tmpDir)

    // .sqldoc/ directory exists
    expect(fs.existsSync(path.join(tmpDir, '.sqldoc'))).toBe(true)

    // .sqldoc/package.json exists with correct structure
    const pkgPath = path.join(tmpDir, '.sqldoc', 'package.json')
    expect(fs.existsSync(pkgPath)).toBe(true)
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    expect(pkg.name).toBe('sqldoc-local')
    expect(pkg.private).toBe(true)
    expect(pkg.dependencies).not.toBe(undefined)
    expect(pkg.dependencies['@sqldoc/cli']).not.toBe(undefined)
  })

  it('symlinks @sqldoc packages into .sqldoc/node_modules/', () => {
    initProject(tmpDir)

    // @sqldoc/cli symlink exists
    const cliLink = path.join(tmpDir, '.sqldoc', 'node_modules', '@sqldoc', 'cli')
    expect(fs.existsSync(cliLink)).toBe(true)
    const stat = fs.lstatSync(cliLink)
    expect(stat.isSymbolicLink()).toBe(true)

    // @sqldoc/core symlink exists
    const coreLink = path.join(tmpDir, '.sqldoc', 'node_modules', '@sqldoc', 'core')
    expect(fs.existsSync(coreLink)).toBe(true)

    // At least some namespace packages are linked
    const nsAudit = path.join(tmpDir, '.sqldoc', 'node_modules', '@sqldoc', 'ns-audit')
    expect(fs.existsSync(nsAudit)).toBe(true)
  })

  it('scaffolds sqldoc.config.ts at project root', () => {
    initProject(tmpDir)

    const configPath = path.join(tmpDir, 'sqldoc.config.ts')
    expect(fs.existsSync(configPath)).toBe(true)

    const content = fs.readFileSync(configPath, 'utf-8')
    expect(content).toContain('export default')
  })

  it('creates .sqldoc/.gitignore with node_modules/', () => {
    initProject(tmpDir)

    const gitignorePath = path.join(tmpDir, '.sqldoc', '.gitignore')
    expect(fs.existsSync(gitignorePath)).toBe(true)
    expect(fs.readFileSync(gitignorePath, 'utf-8')).toContain('node_modules/')
  })

  it('creates .sqldoc/config.d.ts for typed config', () => {
    initProject(tmpDir)

    const configDts = path.join(tmpDir, '.sqldoc', 'config.d.ts')
    expect(fs.existsSync(configDts)).toBe(true)
  })

  it('errors when .sqldoc/ already exists', () => {
    initProject(tmpDir)
    // Run init again — should fail
    const result = runShim(`init --dev ${MONOREPO_ROOT}`, tmpDir, { expectFail: true })
    expect(result.exitCode).not.toBe(0)
  })
})

// -- 2. Codegen test --

describe('codegen workflow', () => {
  it('generates HTML docs and TypeScript types from schema', () => {
    initProject(tmpDir)

    // Write config
    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  dialect: 'postgres',
  schema: 'schema.sql',
  namespaces: {
    docs: {
      format: 'html',
      output: 'docs/schema.html',
    },
    codegen: {
      templates: [
        {
          template: '@sqldoc/templates/typescript',
          output: 'generated/types.ts',
        },
      ],
    },
  },
}
`,
    )

    // Write schema with tags
    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-comment'
-- @import '@sqldoc/ns-docs'
-- @import '@sqldoc/ns-codegen'

-- @audit(on: [insert, update, delete])
-- @comment('Users table for the application')
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  -- @comment('Full user name')
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
`,
    )

    runCli('codegen', tmpDir)

    // Verify HTML docs generated
    const htmlPath = path.join(tmpDir, 'docs', 'schema.html')
    expect(fs.existsSync(htmlPath)).toBe(true)
    const html = fs.readFileSync(htmlPath, 'utf-8')
    expect(html).toContain('users')
    expect(html).toContain('<html')

    // Verify TypeScript types generated
    const tsPath = path.join(tmpDir, 'generated', 'types.ts')
    expect(fs.existsSync(tsPath)).toBe(true)
    const tsContent = fs.readFileSync(tsPath, 'utf-8')
    expect(tsContent).toContain('export interface User')
    expect(tsContent).toContain('name: string')
    expect(tsContent).toContain('email: string')
    // Audit generates an audit_log table
    expect(tsContent).toContain('UsersAuditLog')
  })

  it('generates TypeScript interfaces with correct types', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  dialect: 'postgres',
  schema: 'schema.sql',
  namespaces: {
    codegen: {
      templates: [
        {
          template: '@sqldoc/templates/typescript',
          output: 'generated/types.ts',
        },
      ],
    },
  },
}
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `-- @import '@sqldoc/ns-codegen'

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  active BOOLEAN DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
`,
    )

    runCli('codegen', tmpDir)

    const tsPath = path.join(tmpDir, 'generated', 'types.ts')
    expect(fs.existsSync(tsPath)).toBe(true)

    const tsContent = fs.readFileSync(tsPath, 'utf-8')
    expect(tsContent).toContain('export interface Product')
    expect(tsContent).toContain('Generated by @sqldoc/templates/typescript')
    // Check type mappings
    expect(tsContent).toContain('name: string')
    expect(tsContent).toContain('price: number')
  })
})

// -- 3. Schema inspect test --

describe('schema inspect workflow', () => {
  it('outputs JSON schema with tables, columns, and types', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default { dialect: 'postgres' }
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  age INTEGER
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  total NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
`,
    )

    const result = runCli('schema inspect schema.sql --format json', tmpDir)

    // stdout may contain progress lines (e.g. "-- schema.sql") before JSON
    const jsonStart = result.stdout.indexOf('{')
    expect(jsonStart >= 0).toBeTruthy()
    const schema = JSON.parse(result.stdout.slice(jsonStart))

    // Verify schema structure
    expect(schema.schemas !== undefined).toBeTruthy()
    expect(Array.isArray(schema.schemas)).toBeTruthy()
    expect(schema.schemas.length > 0).toBeTruthy()

    const publicSchema = schema.schemas.find((s: any) => s.name === 'public')
    expect(publicSchema).not.toBe(undefined)

    // Verify tables
    const tables = publicSchema.tables
    expect(tables).toHaveLength(2)

    const usersTable = tables.find((t: any) => t.name === 'users')
    expect(usersTable).not.toBe(undefined)
    expect(usersTable.columns).toHaveLength(4)

    // Verify column names
    const columnNames = usersTable.columns.map((c: any) => c.name)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('name')
    expect(columnNames).toContain('email')
    expect(columnNames).toContain('age')

    // Verify column types
    const nameCol = usersTable.columns.find((c: any) => c.name === 'name')
    expect(nameCol.type.T).toBe('text')

    const ordersTable = tables.find((t: any) => t.name === 'orders')
    expect(ordersTable).not.toBe(undefined)
    expect(ordersTable.columns).toHaveLength(4)
  })
})

// -- 4. Schema diff test --

describe('schema diff workflow', () => {
  it('detects added column with ALTER TABLE', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default { dialect: 'postgres' }
`,
    )

    // "Before" schema — users table without email
    fs.writeFileSync(
      path.join(tmpDir, 'before.sql'),
      `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
`,
    )

    // "After" schema — users table with email added
    fs.writeFileSync(
      path.join(tmpDir, 'after.sql'),
      `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);
`,
    )

    const result = runCli('schema diff --from before.sql --to after.sql', tmpDir)

    // stdout should contain ALTER TABLE ... ADD COLUMN
    expect(result.stdout).toContain('ALTER TABLE')
    expect(result.stdout).toContain('ADD COLUMN')
    expect(result.stdout).toContain('email')
  })

  it('detects added table with CREATE TABLE', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default { dialect: 'postgres' }
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'before.sql'),
      `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'after.sql'),
      `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  total INTEGER NOT NULL
);
`,
    )

    const result = runCli('schema diff --from before.sql --to after.sql', tmpDir)

    expect(result.stdout).toContain('CREATE TABLE')
    expect(result.stdout).toContain('orders')
  })

  it('reports no changes when schemas are identical', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default { dialect: 'postgres' }
`,
    )

    const schema = `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
`
    fs.writeFileSync(path.join(tmpDir, 'before.sql'), schema)
    fs.writeFileSync(path.join(tmpDir, 'after.sql'), schema)

    const result = runCli('schema diff --from before.sql --to after.sql', tmpDir)

    // stdout may contain progress lines but should NOT contain any DDL statements
    expect(result.stdout).not.toContain('ALTER TABLE')
    expect(result.stdout).not.toContain('CREATE TABLE')
    expect(result.stdout).not.toContain('DROP TABLE')
  })

  it('detects dropped column', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default { dialect: 'postgres' }
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'before.sql'),
      `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'after.sql'),
      `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
`,
    )

    const result = runCli('schema diff --from before.sql --to after.sql', tmpDir)

    expect(result.stdout).toContain('ALTER TABLE')
    expect(result.stdout).toContain('DROP COLUMN')
    expect(result.stdout).toContain('email')
  })
})

// -- 5. Lint test --

describe('lint workflow', () => {
  it('reports lint warnings for tables missing @audit', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default { dialect: 'postgres', schema: 'schema.sql' }
`,
    )

    // Schema with @audit imported but only one table audited, other has @comment but no @audit
    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-comment'

-- @audit(on: [insert, update, delete])
-- @comment('Audited table')
CREATE TABLE audited_table (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

-- @comment('This table is missing audit')
CREATE TABLE unaudited_table (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL
);
`,
    )

    // Lint should produce a warning (default severity for audit.require-audit is 'warn')
    // Since warnings don't cause non-zero exit, this should succeed
    const result = runCli('lint', tmpDir)

    // The output goes to stdout — check combined output
    const combined = result.stdout + result.stderr
    expect(combined).toContain('unaudited_table')
    expect(combined).toContain('audit.require-audit')
  })

  it('reports lint errors when configured with error severity', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  dialect: 'postgres',
  schema: 'schema.sql',
  lint: {
    rules: {
      'audit.require-audit': 'error',
    },
  },
}
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-comment'

-- @comment('Missing audit — should be error')
CREATE TABLE important_table (
  id BIGSERIAL PRIMARY KEY,
  data TEXT NOT NULL
);
`,
    )

    // Lint should fail with non-zero exit code due to error severity
    const result = runCli('lint', tmpDir, { expectFail: true })
    expect(result.exitCode).not.toBe(0)

    const combined = result.stdout + result.stderr
    expect(combined).toContain('important_table')
    expect(combined).toContain('error')
  })

  it('suppresses lint with @lint.ignore', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  dialect: 'postgres',
  schema: 'schema.sql',
  lint: {
    rules: {
      'audit.require-audit': 'error',
    },
  },
}
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-comment'
-- @import '@sqldoc/ns-lint'

-- @comment('Intentionally no audit')
-- @lint.ignore('audit.require-audit', 'Temporary staging table')
CREATE TABLE staging_data (
  id BIGSERIAL PRIMARY KEY,
  payload TEXT NOT NULL
);
`,
    )

    // Lint should succeed — the error is suppressed by @lint.ignore
    const result = runCli('lint -v', tmpDir)

    const combined = result.stdout + result.stderr
    // Verbose mode shows skipped rules
    expect(combined).toContain('staging_data')
    expect(combined).toContain('ignored')
  })

  it('reports no issues when all tables have @audit', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default { dialect: 'postgres', schema: 'schema.sql' }
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `-- @import '@sqldoc/ns-audit'

-- @audit(on: [insert, update])
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
`,
    )

    const result = runCli('lint', tmpDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('No lint issues found')
  })
})

// -- 6. Migrate test --

describe('migrate workflow', () => {
  it('generates a goose migration file from schema', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  dialect: 'postgres',
  schema: 'schema.sql',
  migrations: {
    dir: 'migrations',
    format: 'goose',
  },
}
`,
    )

    fs.mkdirSync(path.join(tmpDir, 'migrations'))

    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);
`,
    )

    runCli('migrate --name init', tmpDir)

    // Verify migration file was created
    const migrationsDir = path.join(tmpDir, 'migrations')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
    expect(files).toHaveLength(1)

    // Verify filename format: YYYYMMDDHHMMSS_init.sql
    expect(files[0]).toMatch(/^\d{14}_init\.sql$/)

    // Verify goose format markers
    const content = fs.readFileSync(path.join(migrationsDir, files[0]), 'utf-8')
    expect(content).toContain('-- +goose Up')
    expect(content).toContain('-- +goose Down')
    expect(content).toContain('CREATE TABLE')
    expect(content).toContain('users')
    expect(content).toContain('DROP TABLE')
  })

  it('generates a plain migration file', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  dialect: 'postgres',
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
      `CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  total INTEGER NOT NULL,
  status TEXT DEFAULT 'pending'
);
`,
    )

    runCli('migrate --name add_orders', tmpDir)

    const files = fs.readdirSync(path.join(tmpDir, 'migrations')).filter((f) => f.endsWith('.sql'))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d{14}_add_orders\.sql$/)

    const content = fs.readFileSync(path.join(tmpDir, 'migrations', files[0]), 'utf-8')
    expect(content).toContain('CREATE TABLE')
    expect(content).toContain('orders')
    // Plain format should NOT have goose markers
    expect(content).not.toContain('-- +goose')
  })

  it('generates incremental migration when existing migrations exist', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  dialect: 'postgres',
  schema: 'schema.sql',
  migrations: {
    dir: 'migrations',
    format: 'goose',
  },
}
`,
    )

    const migrationsDir = path.join(tmpDir, 'migrations')
    fs.mkdirSync(migrationsDir)

    // Create an initial migration that already exists
    fs.writeFileSync(
      path.join(migrationsDir, '20260101000000_initial.sql'),
      `-- +goose Up
CREATE TABLE "public"."users" ("id" bigserial NOT NULL, "name" text NOT NULL, PRIMARY KEY ("id"));

-- +goose Down
DROP TABLE "public"."users";
`,
    )

    // Schema now has an additional column
    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);
`,
    )

    runCli('migrate --name add_email', tmpDir)

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    expect(files).toHaveLength(2)

    // Second file should be the incremental migration
    const newMigration = files[1]
    expect(newMigration).toContain('add_email')

    const content = fs.readFileSync(path.join(migrationsDir, newMigration), 'utf-8')
    expect(content).toContain('-- +goose Up')
    expect(content).toContain('ALTER TABLE')
    expect(content).toContain('email')
  })

  it('reports no changes when schema matches migrations', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  dialect: 'postgres',
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

    // Migration already contains the full schema
    fs.writeFileSync(
      path.join(migrationsDir, '20260101000000_init.sql'),
      `CREATE TABLE "public"."users" ("id" bigserial NOT NULL, "name" text NOT NULL, PRIMARY KEY ("id"));
`,
    )

    // Schema matches the migration
    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
`,
    )

    const result = runCli('migrate', tmpDir)
    const combined = result.stdout + result.stderr
    // The "No schema changes detected" message goes to stderr via console.error
    expect(combined).toContain('No schema changes')

    // No new migration files should be created
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
    expect(files).toHaveLength(1)
  })
})

// -- 7. Validate test --

describe('validate workflow', () => {
  it('succeeds with valid tags and imports', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default { dialect: 'postgres' }
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `-- @import '@sqldoc/ns-comment'

-- @comment('Users table')
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  -- @comment('Full name')
  name TEXT NOT NULL
);
`,
    )

    const result = runCli('validate schema.sql', tmpDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('0 error(s)')
  })

  it('fails with unknown namespace', () => {
    initProject(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default { dialect: 'postgres' }
`,
    )

    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `-- @nonexistent.tag
CREATE TABLE bad (
  id BIGSERIAL PRIMARY KEY
);
`,
    )

    const result = runCli('validate schema.sql', tmpDir, { expectFail: true })
    expect(result.exitCode).not.toBe(0)

    const combined = result.stdout + result.stderr
    expect(combined).toContain('error')
  })
})

// -- 8. Combined workflow test --

describe('combined workflow', () => {
  it('runs full init -> codegen -> inspect -> diff -> migrate pipeline', () => {
    // 1. Init
    initProject(tmpDir)

    // 2. Write initial schema
    fs.writeFileSync(
      path.join(tmpDir, 'sqldoc.config.ts'),
      `export default {
  dialect: 'postgres',
  schema: 'schema.sql',
  namespaces: {
    codegen: {
      templates: [
        {
          template: '@sqldoc/templates/typescript',
          output: 'generated/types.ts',
        },
      ],
    },
  },
  migrations: {
    dir: 'migrations',
    format: 'goose',
  },
}
`,
    )

    fs.mkdirSync(path.join(tmpDir, 'migrations'))

    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `-- @import '@sqldoc/ns-codegen'

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);
`,
    )

    // 3. Codegen
    runCli('codegen', tmpDir)
    const tsPath = path.join(tmpDir, 'generated', 'types.ts')
    expect(fs.existsSync(tsPath)).toBe(true)
    expect(fs.readFileSync(tsPath, 'utf-8')).toContain('export interface User')

    // 4. Schema inspect
    const inspectResult = runCli('schema inspect schema.sql --format json', tmpDir)
    const jsonStart = inspectResult.stdout.indexOf('{')
    const schema = JSON.parse(inspectResult.stdout.slice(jsonStart))
    expect(schema.schemas[0].tables).toHaveLength(1)

    // 5. Generate initial migration
    runCli('migrate --name initial', tmpDir)
    const migFiles = fs.readdirSync(path.join(tmpDir, 'migrations')).filter((f) => f.endsWith('.sql'))
    expect(migFiles).toHaveLength(1)
    expect(fs.readFileSync(path.join(tmpDir, 'migrations', migFiles[0]), 'utf-8')).toContain('-- +goose Up')

    // 6. Evolve schema — add a column
    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      `-- @import '@sqldoc/ns-codegen'

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  bio TEXT
);
`,
    )

    // 7. Diff to see the change
    fs.writeFileSync(
      path.join(tmpDir, 'before.sql'),
      `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);
`,
    )
    const diffResult = runCli('schema diff --from before.sql --to schema.sql', tmpDir)
    expect(diffResult.stdout).toContain('ALTER TABLE')
    expect(diffResult.stdout).toContain('bio')

    // 8. Generate incremental migration
    runCli('migrate --name add_bio', tmpDir)
    const migFiles2 = fs
      .readdirSync(path.join(tmpDir, 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
    expect(migFiles2).toHaveLength(2)
    expect(fs.readFileSync(path.join(tmpDir, 'migrations', migFiles2[1]), 'utf-8')).toContain('bio')
  })
})
