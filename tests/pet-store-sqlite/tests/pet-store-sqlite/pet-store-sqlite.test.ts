/**
 * Pet Store E2E integration test (SQLite dialect).
 *
 * Exercises SQLite-compatible plugins (codegen, lint, custom)
 * + @external/@include directives. Zero-config — uses in-memory SQLite.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, initProject, it, runCli } from '@sqldoc/test-utils'

const projectDir = import.meta.dirname

function ensureInit(): void {
  const nodeModules = path.join(projectDir, '.sqldoc', 'node_modules')
  if (!fs.existsSync(nodeModules)) {
    fs.rmSync(path.join(projectDir, '.sqldoc'), { recursive: true, force: true })
    initProject(projectDir)
  }
}

describe('validate workflow', () => {
  it('validates all tags with zero errors', () => {
    ensureInit()
    const result = runCli('validate schema.sql', projectDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('0 error(s)')
  })
})

describe('codegen workflow', () => {
  it('runs codegen and generates output in place', () => {
    ensureInit()
    const result = runCli('codegen', projectDir)
    expect(result.exitCode).toBe(0)
  })

  it('generates TypeScript types for project, external, and included tables', () => {
    const tsPath = path.join(projectDir, 'generated', 'types.ts')
    expect(fs.existsSync(tsPath)).toBe(true)

    const tsContent = fs.readFileSync(tsPath, 'utf-8')
    expect(tsContent).toContain('export interface Adoption')
    expect(tsContent).toContain('export interface Category')
    expect(tsContent).toContain('export interface Pet')
    expect(tsContent).not.toContain('export interface Staff {')

    // External table (locations)
    expect(tsContent).toContain('export interface Location')

    // Included table (reviews)
    expect(tsContent).toContain('export interface Review')
  })
})

describe('migrate workflow', () => {
  it('produces no new migration (schema matches committed migration)', () => {
    ensureInit()
    const result = runCli('migrate', projectDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('No schema changes detected')
  })
})

describe('lint workflow', () => {
  it('reports no lint errors', () => {
    ensureInit()
    const result = runCli('lint', projectDir)
    expect(result.exitCode).toBe(0)
  })
})

describe('namespace coverage', () => {
  it('schema imports 3 plugins (2 portable + 1 custom)', () => {
    const schema = fs.readFileSync(path.join(projectDir, 'schema.sql'), 'utf-8')
    const importLines = schema.split('\n').filter((line) => line.match(/^-- @import /))
    expect(importLines).toHaveLength(3)
  })

  it('schema declares @external and @include directives', () => {
    const schema = fs.readFileSync(path.join(projectDir, 'schema.sql'), 'utf-8')
    expect(schema).toContain("-- @external './external/locations.sql'")
    expect(schema).toContain("-- @include './include/reviews.sql'")
  })
})
