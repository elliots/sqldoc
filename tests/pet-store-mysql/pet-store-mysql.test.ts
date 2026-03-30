/**
 * Pet Store E2E integration test (MySQL dialect).
 *
 * Exercises portable namespace plugins (no Postgres-only: rls, anon, postgraphile)
 * + 1 custom local plugin in a MySQL schema. Requires Docker for MySQL.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, initProject, it, runCli } from '@sqldoc/test-utils'

function setupProject(tmpDir: string): void {
  initProject(tmpDir)

  fs.writeFileSync(
    path.join(tmpDir, 'sqldoc.config.ts'),
    `export default {
  dialect: 'mysql',
  schema: 'schema.sql',
  devUrl: 'docker://mysql:8',
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

  const schemaSource = fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf-8')
  fs.writeFileSync(path.join(tmpDir, 'schema.sql'), schemaSource)

  const pluginSource = fs.readFileSync(path.join(import.meta.dirname, 'custom-plugin.ts'), 'utf-8')
  fs.writeFileSync(path.join(tmpDir, 'custom-plugin.ts'), pluginSource)
}

// -- Test suite --

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-pet-store-mysql-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('validate workflow', { timeout: 120_000 }, () => {
  it('validates all tags with zero errors', () => {
    setupProject(tmpDir)
    const result = runCli('validate schema.sql', tmpDir)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('0 error(s)')
  })
})

describe('codegen workflow', { timeout: 120_000 }, () => {
  it('runs codegen successfully', () => {
    setupProject(tmpDir)
    const result = runCli('codegen', tmpDir)
    expect(result.exitCode).toBe(0)
  })

  it('generates TypeScript types', () => {
    setupProject(tmpDir)
    runCli('codegen', tmpDir)

    const tsPath = path.join(tmpDir, 'generated', 'types.ts')
    expect(fs.existsSync(tsPath)).toBe(true)

    const tsContent = fs.readFileSync(tsPath, 'utf-8')
    expect(tsContent).toContain('export interface Adoption')
    expect(tsContent).toContain('export interface Category')
    expect(tsContent).toContain('export interface Pet')
    expect(tsContent).not.toContain('export interface Staff {')
  })
})

describe('lint workflow', { timeout: 120_000 }, () => {
  it('reports no lint errors', () => {
    setupProject(tmpDir)
    const result = runCli('lint', tmpDir)
    expect(result.exitCode).toBe(0)
  })
})

describe('namespace coverage', { timeout: 120_000 }, () => {
  it('schema imports 8 plugins (7 portable + 1 custom)', () => {
    setupProject(tmpDir)
    const schema = fs.readFileSync(path.join(tmpDir, 'schema.sql'), 'utf-8')
    const importLines = schema.split('\n').filter((line) => line.match(/^-- @import /))
    expect(importLines).toHaveLength(8)
  })
})
