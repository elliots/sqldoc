/**
 * Pet Store E2E integration test (SQLite dialect).
 *
 * Exercises SQLite-compatible plugins (no: rls, anon, postgraphile, comment, deprecated)
 * + 1 custom local plugin. Zero-config — uses in-memory SQLite.
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
  dialect: 'sqlite',
  schema: 'schema.sql',
  namespaces: {
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-pet-store-sqlite-'))
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

// Note: codegen (Tier 2) requires Atlas WASI + better-sqlite3 which uses CJS require().
// This fails under node --test with ESM. SQLite codegen is tested via unit tests instead.

// Note: lint also requires Tier 2 pipeline (Atlas WASI + better-sqlite3 CJS).
// SQLite lint is tested via unit tests instead.

describe('namespace coverage', { timeout: 120_000 }, () => {
  it('schema imports 6 plugins (5 portable + 1 custom)', () => {
    setupProject(tmpDir)
    const schema = fs.readFileSync(path.join(tmpDir, 'schema.sql'), 'utf-8')
    const importLines = schema.split('\n').filter((line) => line.match(/^-- @import /))
    expect(importLines).toHaveLength(6)
  })

  it('schema declares @external and @include directives', () => {
    setupProject(tmpDir)
    const schema = fs.readFileSync(path.join(tmpDir, 'schema.sql'), 'utf-8')
    expect(schema).toContain("-- @external './external/locations.sql'")
    expect(schema).toContain("-- @include './include/reviews.sql'")
  })
})
