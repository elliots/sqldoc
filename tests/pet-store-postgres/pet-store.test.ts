/**
 * Pet Store E2E integration test.
 *
 * Exercises all 10 namespace plugins + 1 custom local plugin in a realistic
 * Postgres schema. Runs codegen in-place so generated output is committed
 * and changes are visible in git diffs.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, initProject, it, runCli } from '@sqldoc/test-utils'

const projectDir = import.meta.dirname

// Ensure .sqldoc/ exists (idempotent — skips if already present)
function ensureInit(): void {
  const sqldocDir = path.join(projectDir, '.sqldoc')
  if (!fs.existsSync(sqldocDir)) {
    initProject(projectDir)
  }
}

// -- validate workflow --

describe('validate workflow', { timeout: 120_000 }, () => {
  it('validates all tags with zero errors', () => {
    ensureInit()
    const result = runCli('validate schema.sql', projectDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('0 error(s)')
  })
})

// -- codegen workflow --

describe('codegen workflow', { timeout: 120_000 }, () => {
  it('runs codegen and generates output in place', () => {
    ensureInit()
    const result = runCli('codegen', projectDir)
    expect(result.exitCode).toBe(0)
  })

  it('generates TypeScript types for project, external, and included tables', () => {
    const tsPath = path.join(projectDir, 'generated', 'types.ts')
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

    // Included table (reviews)
    expect(tsContent).toContain('export interface Review')

    // Typical type fields present
    expect(tsContent).toContain('name: string')
  })

  it('generates HTML docs', () => {
    const htmlPath = path.join(projectDir, 'docs', 'schema.html')
    expect(fs.existsSync(htmlPath)).toBe(true)

    const html = fs.readFileSync(htmlPath, 'utf-8')
    expect(html).toContain('<html')
    expect(html).toContain('categories')
    expect(html).toContain('pets')
    expect(html).toContain('owners')
    expect(html).toContain('adoptions')
  })
})

// -- migrate workflow --

describe('migrate workflow', { timeout: 120_000 }, () => {
  it('produces no new migration (schema matches committed migration)', () => {
    ensureInit()
    const result = runCli('migrate', projectDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('No schema changes detected')
  })
})

// -- lint workflow --

describe('lint workflow', { timeout: 120_000 }, () => {
  it('reports no lint errors', () => {
    ensureInit()
    const result = runCli('lint', projectDir)
    expect(result.exitCode).toBe(0)
  })

  it('shows lint.ignore suppression with verbose flag', () => {
    ensureInit()
    const result = runCli('lint -v', projectDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('legacy_inventory')
    expect(combined).toContain('ignored')
  })
})

// -- namespace coverage --

describe('namespace coverage', { timeout: 120_000 }, () => {
  it('schema imports all 10 namespace plugins plus custom local plugin', () => {
    const schema = fs.readFileSync(path.join(projectDir, 'schema.sql'), 'utf-8')
    const importLines = schema.split('\n').filter((line) => line.match(/^-- @import /))
    expect(importLines).toHaveLength(10)
  })

  it('schema contains 7 CREATE TABLE statements (project only)', () => {
    const schema = fs.readFileSync(path.join(projectDir, 'schema.sql'), 'utf-8')
    const createCount = (schema.match(/CREATE TABLE /g) || []).length
    expect(createCount).toBe(7)
  })

  it('schema declares @external and @include directives', () => {
    const schema = fs.readFileSync(path.join(projectDir, 'schema.sql'), 'utf-8')
    expect(schema).toContain("-- @external './external/locations.sql'")
    expect(schema).toContain("-- @include './include/reviews.sql'")
  })
})

// -- @external/@include directives --

describe('directive behavior', { timeout: 120_000 }, () => {
  it('rejects external files that FK-reference project tables', () => {
    ensureInit()

    // Create a temporary bad external file
    const badFile = path.join(projectDir, 'external', 'bad-external.sql')
    fs.writeFileSync(
      badFile,
      `CREATE TABLE bad_external (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER REFERENCES pets(id)
);`,
    )

    // Temporarily add it to schema
    const schemaPath = path.join(projectDir, 'schema.sql')
    const original = fs.readFileSync(schemaPath, 'utf-8')
    fs.writeFileSync(
      schemaPath,
      original.replace(
        "-- @external './external/locations.sql'",
        "-- @external './external/locations.sql'\n-- @external './external/bad-external.sql'",
      ),
    )

    try {
      const result = runCli('codegen', projectDir, { expectFail: true })
      expect(result.exitCode).toBe(1)
    } finally {
      // Clean up
      fs.writeFileSync(schemaPath, original)
      fs.unlinkSync(badFile)
    }
  })
})

// -- custom local plugin --

describe('custom local plugin', { timeout: 120_000 }, () => {
  it('custom plugin file is loaded via relative import', () => {
    ensureInit()
    const result = runCli('validate schema.sql', projectDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('0 error(s)')
  })

  it('custom plugin produces SQL during compilation', () => {
    ensureInit()
    const result = runCli('codegen', projectDir)
    expect(result.exitCode).toBe(0)
  })
})
