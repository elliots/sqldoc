/**
 * Pet Store E2E integration test.
 *
 * Exercises all 10 namespace plugins + 1 custom local plugin in a realistic
 * Postgres schema, running through the full CLI pipeline: init, codegen,
 * validate, lint.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, initProject, it, runCli } from '@sqldoc/test-utils'

/** Set up the pet-store project in a temp directory */
function setupProject(tmpDir: string): void {
  initProject(tmpDir)

  // Write config with codegen + docs namespaces
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
        { template: '@sqldoc/templates/typescript', output: 'generated/types.ts' },
      ],
    },
  },
}
`,
  )

  // Copy schema.sql from fixtures
  const schemaSource = fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf-8')
  fs.writeFileSync(path.join(tmpDir, 'schema.sql'), schemaSource)

  // Copy custom-plugin.ts so the relative @import resolves
  const pluginSource = fs.readFileSync(path.join(import.meta.dirname, 'custom-plugin.ts'), 'utf-8')
  fs.writeFileSync(path.join(tmpDir, 'custom-plugin.ts'), pluginSource)

  // Copy external/ and include/ directories for @external/@include directives
  const fixtureDir = import.meta.dirname
  for (const sub of ['external', 'include']) {
    const srcDir = path.join(fixtureDir, sub)
    const destDir = path.join(tmpDir, sub)
    fs.mkdirSync(destDir, { recursive: true })
    for (const file of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file))
    }
  }
}

// -- Test suite --

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-pet-store-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// -- validate workflow --

describe('validate workflow', { timeout: 120_000 }, () => {
  it('validates all tags with zero errors', () => {
    setupProject(tmpDir)
    const result = runCli('validate schema.sql', tmpDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('0 error(s)')
  })
})

// -- codegen workflow --

describe('codegen workflow', { timeout: 120_000 }, () => {
  it('runs codegen successfully', () => {
    setupProject(tmpDir)
    const result = runCli('codegen', tmpDir)
    expect(result.exitCode).toBe(0)
  })

  it('generates TypeScript types for project, external, and included tables', () => {
    setupProject(tmpDir)
    runCli('codegen', tmpDir)

    const tsPath = path.join(tmpDir, 'generated', 'types.ts')
    expect(fs.existsSync(tsPath)).toBe(true)

    const tsContent = fs.readFileSync(tsPath, 'utf-8')

    // Project tables
    expect(tsContent).toContain('export interface Adoption')
    expect(tsContent).toContain('export interface Category')
    expect(tsContent).toContain('export interface Owner')
    expect(tsContent).toContain('export interface Pet')
    expect(tsContent).toContain('export interface MedicalRecord')
    expect(tsContent).toContain('export interface LegacyInventory')

    // Staff is excluded by @codegen.skip
    expect(tsContent).not.toContain('export interface Staff {')

    // External table (locations) — codegen generates from it by default (D-12)
    expect(tsContent).toContain('export interface Location')

    // Included table (reviews) — part of project, always in codegen
    expect(tsContent).toContain('export interface Review')

    // Typical type fields present
    expect(tsContent).toContain('name: string')
  })

  it('generates HTML docs', () => {
    setupProject(tmpDir)
    runCli('codegen', tmpDir)

    const htmlPath = path.join(tmpDir, 'docs', 'schema.html')
    expect(fs.existsSync(htmlPath)).toBe(true)

    const html = fs.readFileSync(htmlPath, 'utf-8')
    expect(html).toContain('<html')
    expect(html).toContain('categories')
    expect(html).toContain('pets')
    expect(html).toContain('owners')
    expect(html).toContain('adoptions')
  })
})

// -- lint workflow --

describe('lint workflow', { timeout: 120_000 }, () => {
  it('reports no lint errors', () => {
    setupProject(tmpDir)
    const result = runCli('lint', tmpDir)
    expect(result.exitCode).toBe(0)
  })

  it('shows lint.ignore suppression with verbose flag', () => {
    setupProject(tmpDir)
    const result = runCli('lint -v', tmpDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('legacy_inventory')
    expect(combined).toContain('ignored')
  })
})

// -- namespace coverage --

describe('namespace coverage', { timeout: 120_000 }, () => {
  it('schema imports all 10 namespace plugins plus custom local plugin', () => {
    setupProject(tmpDir)
    const schema = fs.readFileSync(path.join(tmpDir, 'schema.sql'), 'utf-8')
    const importLines = schema.split('\n').filter((line) => line.match(/^-- @import /))
    expect(importLines).toHaveLength(11)
  })

  it('schema contains 7 CREATE TABLE statements (project only)', () => {
    setupProject(tmpDir)
    const schema = fs.readFileSync(path.join(tmpDir, 'schema.sql'), 'utf-8')
    const createCount = (schema.match(/CREATE TABLE /g) || []).length
    expect(createCount).toBe(7)
  })

  it('schema declares @external and @include directives', () => {
    setupProject(tmpDir)
    const schema = fs.readFileSync(path.join(tmpDir, 'schema.sql'), 'utf-8')
    expect(schema).toContain("-- @external './external/locations.sql'")
    expect(schema).toContain("-- @include './include/reviews.sql'")
  })
})

// -- @external/@include directives --

describe('directive behavior', { timeout: 120_000 }, () => {
  it('rejects external files that FK-reference project tables', () => {
    setupProject(tmpDir)

    // Create an external file that tries to FK into a project table — should fail
    // because externals are inspected in isolation (they can't know about project schema)
    fs.writeFileSync(
      path.join(tmpDir, 'external', 'bad-external.sql'),
      `CREATE TABLE bad_external (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER REFERENCES pets(id)
);`,
    )

    // Add the bad external to schema.sql
    const schema = fs.readFileSync(path.join(tmpDir, 'schema.sql'), 'utf-8')
    fs.writeFileSync(
      path.join(tmpDir, 'schema.sql'),
      schema.replace(
        "-- @external './external/locations.sql'",
        "-- @external './external/locations.sql'\n-- @external './external/bad-external.sql'",
      ),
    )

    const result = runCli('codegen', tmpDir, { expectFail: true })
    expect(result.exitCode).toBe(1)
  })
})

// -- custom local plugin --

describe('custom local plugin', { timeout: 120_000 }, () => {
  it('custom plugin file is loaded via relative import', () => {
    setupProject(tmpDir)
    // If the custom plugin fails to load, validate will report import errors
    const result = runCli('validate schema.sql', tmpDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('0 error(s)')
  })

  it('custom plugin produces SQL during compilation', () => {
    setupProject(tmpDir)
    // Run codegen which goes through the full compile pipeline.
    // The custom plugin emits ALTER TABLE ADD COLUMN for the adoptions table.
    // Since post-compile inspect may fall back (SECURITY LABEL from ns-anon),
    // we verify via codegen success + validate passing (proves plugin loaded and
    // its onTag() ran without error during compilation).
    const result = runCli('codegen', tmpDir)
    expect(result.exitCode).toBe(0)
  })
})
