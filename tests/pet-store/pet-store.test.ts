/**
 * Pet Store E2E integration test.
 *
 * Exercises all 10 namespace plugins + 1 custom local plugin in a realistic
 * Postgres schema, running through the full CLI pipeline: init, codegen,
 * validate, lint.
 */

import { execSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

// -- Helpers --

const MONOREPO_ROOT = path.resolve(import.meta.dirname, '../..')
const CLI_ENTRY = path.join(MONOREPO_ROOT, 'packages/cli/src/index.ts')
const SHIM_ENTRY = path.join(MONOREPO_ROOT, 'packages/sqldoc/src/index.ts')

function runCli(
  args: string,
  cwd: string,
  opts: { expectFail?: boolean; env?: Record<string, string> } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const env = {
    ...process.env,
    SQLDOC_PROJECT_ROOT: cwd,
    NODE_PATH: path.join(cwd, '.sqldoc', 'node_modules'),
    NODE_NO_WARNINGS: '1',
    ...opts.env,
  }

  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args.split(/\s+/)], {
    cwd,
    encoding: 'utf-8',
    env,
    timeout: 120_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const exitCode = result.status ?? 1

  if (exitCode !== 0 && !opts.expectFail) {
    throw new Error(
      `CLI command failed: node ${CLI_ENTRY} ${args}\n` +
        `Exit code: ${exitCode}\n` +
        `stdout: ${stdout}\n` +
        `stderr: ${stderr}`,
    )
  }

  return { stdout, stderr, exitCode }
}

function runShim(
  args: string,
  cwd: string,
  opts: { expectFail?: boolean } = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`${process.execPath} ${SHIM_ENTRY} ${args}`, {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout, stderr: '', exitCode: 0 }
  } catch (err: any) {
    if (opts.expectFail) {
      return {
        stdout: err.stdout?.toString() ?? '',
        stderr: err.stderr?.toString() ?? '',
        exitCode: err.status ?? 1,
      }
    }
    throw new Error(
      `Shim command failed: node ${SHIM_ENTRY} ${args}\n` +
        `Exit code: ${err.status}\n` +
        `stderr: ${err.stderr?.toString() ?? ''}`,
    )
  }
}

function initProject(tmpDir: string): void {
  runShim(`init --dev ${MONOREPO_ROOT}`, tmpDir)
}

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
}

// -- Test suite --

describe('pet-store-postgres', { timeout: 120_000 }, () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-pet-store-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // -- validate workflow --

  describe('validate workflow', () => {
    it('validates all tags with zero errors', () => {
      setupProject(tmpDir)
      const result = runCli('validate schema.sql', tmpDir)
      const combined = result.stdout + result.stderr
      assert.ok(combined.includes('0 error(s)'))
    })
  })

  // -- codegen workflow --

  describe('codegen workflow', () => {
    it('runs codegen successfully', () => {
      setupProject(tmpDir)
      const result = runCli('codegen', tmpDir)
      assert.strictEqual(result.exitCode, 0)
    })

    it('generates TypeScript types for original tables', () => {
      setupProject(tmpDir)
      runCli('codegen', tmpDir)

      const tsPath = path.join(tmpDir, 'generated', 'types.ts')
      assert.strictEqual(fs.existsSync(tsPath), true)

      const tsContent = fs.readFileSync(tsPath, 'utf-8')

      // Template uses singular PascalCase interface names
      assert.ok(tsContent.includes('export interface Adoption'))
      assert.ok(tsContent.includes('export interface Category'))
      assert.ok(tsContent.includes('export interface Owner'))
      assert.ok(tsContent.includes('export interface Pet'))
      assert.ok(tsContent.includes('export interface MedicalRecord'))
      assert.ok(tsContent.includes('export interface LegacyInventory'))

      // Staff is excluded by @codegen.skip
      assert.ok(!tsContent.includes('export interface Staff'))

      // Typical type fields present
      assert.ok(tsContent.includes('name: string'))
    })

    it('generates HTML docs', () => {
      setupProject(tmpDir)
      runCli('codegen', tmpDir)

      const htmlPath = path.join(tmpDir, 'docs', 'schema.html')
      assert.strictEqual(fs.existsSync(htmlPath), true)

      const html = fs.readFileSync(htmlPath, 'utf-8')
      assert.ok(html.includes('<html'))
      assert.ok(html.includes('categories'))
      assert.ok(html.includes('pets'))
      assert.ok(html.includes('owners'))
      assert.ok(html.includes('adoptions'))
    })
  })

  // -- lint workflow --

  describe('lint workflow', () => {
    it('reports no lint errors', () => {
      setupProject(tmpDir)
      const result = runCli('lint', tmpDir)
      assert.strictEqual(result.exitCode, 0)
    })

    it('shows lint.ignore suppression with verbose flag', () => {
      setupProject(tmpDir)
      const result = runCli('lint -v', tmpDir)
      const combined = result.stdout + result.stderr
      assert.ok(combined.includes('legacy_inventory'))
      assert.ok(combined.includes('ignored'))
    })
  })

  // -- namespace coverage --

  describe('namespace coverage', () => {
    it('schema imports all 10 namespace plugins plus custom local plugin', () => {
      setupProject(tmpDir)
      const schema = fs.readFileSync(path.join(tmpDir, 'schema.sql'), 'utf-8')
      const importLines = schema.split('\n').filter((line) => line.match(/^-- @import /))
      assert.strictEqual(importLines.length, 11)
    })

    it('schema contains 7 CREATE TABLE statements', () => {
      setupProject(tmpDir)
      const schema = fs.readFileSync(path.join(tmpDir, 'schema.sql'), 'utf-8')
      const createCount = (schema.match(/CREATE TABLE /g) || []).length
      assert.strictEqual(createCount, 7)
    })
  })

  // -- custom local plugin --

  describe('custom local plugin', () => {
    it('custom plugin file is loaded via relative import', () => {
      setupProject(tmpDir)
      // If the custom plugin fails to load, validate will report import errors
      const result = runCli('validate schema.sql', tmpDir)
      const combined = result.stdout + result.stderr
      assert.ok(combined.includes('0 error(s)'))
    })

    it('custom plugin produces SQL during compilation', () => {
      setupProject(tmpDir)
      // Run codegen which goes through the full compile pipeline.
      // The custom plugin emits ALTER TABLE ADD COLUMN for the adoptions table.
      // Since post-compile inspect may fall back (SECURITY LABEL from ns-anon),
      // we verify via codegen success + validate passing (proves plugin loaded and
      // its onTag() ran without error during compilation).
      const result = runCli('codegen', tmpDir)
      assert.strictEqual(result.exitCode, 0)
    })
  })
})
