/**
 * Pet Store E2E integration test (MySQL dialect).
 *
 * Exercises portable namespace plugins (no Postgres-only: rls, anon, postgraphile)
 * + 1 custom local plugin. Runs codegen in-place. Requires Docker for MySQL.
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
    // Project tables
    expect(tsContent).toContain('export interface Adoption')
    expect(tsContent).toContain('export interface Category')
    expect(tsContent).toContain('export interface Pet')
    expect(tsContent).not.toContain('export interface Staff {')

    // External table (locations)
    expect(tsContent).toContain('export interface Location')

    // Included table (reviews)
    expect(tsContent).toContain('export interface Review')
  })

  it('generates HTML docs', () => {
    const htmlPath = path.join(projectDir, 'docs', 'schema.html')
    expect(fs.existsSync(htmlPath)).toBe(true)

    const html = fs.readFileSync(htmlPath, 'utf-8')
    expect(html).toContain('<html')
    expect(html).toContain('categories')
    expect(html).toContain('pets')
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
  it('schema imports 8 plugins (7 portable + 1 custom)', () => {
    const schema = fs.readFileSync(path.join(projectDir, 'schema.sql'), 'utf-8')
    const importLines = schema.split('\n').filter((line) => line.match(/^-- @import /))
    expect(importLines).toHaveLength(8)
  })
})
