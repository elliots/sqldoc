import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, mockMethod } from '@sqldoc/test-utils'

describe('validateCommand', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-cli-validate-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    process.exitCode = undefined as any
  })

  it('returns exit code 0 when validation passes', async () => {
    // Create a valid namespace
    const nsFile = path.join(tmpDir, 'ns-valid.ts')
    fs.writeFileSync(
      nsFile,
      `
      export default {
        name: 'valid',
        tags: {
          ok: { description: 'valid tag' },
        },
      }
    `,
      'utf-8',
    )

    const sqlFile = path.join(tmpDir, 'good.sql')
    fs.writeFileSync(
      sqlFile,
      `-- @import './ns-valid.ts'

-- @valid.ok
CREATE TABLE good (
  id serial PRIMARY KEY
);
`,
      'utf-8',
    )

    const consoleSpy = mockMethod(console, 'log', () => {})

    const { validateCommand } = await import('../commands/validate.ts')
    process.exitCode = undefined as any
    await validateCommand(sqlFile, {})

    // No errors = no exitCode set (remains undefined or 0)
    expect(process.exitCode).not.toBe(1)

    consoleSpy.restore()
  })

  it('throws CliError when errors found', async () => {
    // SQL file referencing unknown namespace (no import for it)
    const sqlFile = path.join(tmpDir, 'bad.sql')
    fs.writeFileSync(
      sqlFile,
      `-- @unknown.tag
CREATE TABLE bad (
  id serial PRIMARY KEY
);
`,
      'utf-8',
    )

    const consoleSpy = mockMethod(console, 'log', () => {})

    const { validateCommand } = await import('../commands/validate.ts')
    const { CliError } = await import('../errors.ts')
    await expect(validateCommand(sqlFile, {})).rejects.toThrow(CliError)

    consoleSpy.restore()
  })

  it('formats diagnostics as file:line:col: severity: message', async () => {
    const sqlFile = path.join(tmpDir, 'diag.sql')
    fs.writeFileSync(
      sqlFile,
      `-- @unknown.tag
CREATE TABLE diag (
  id serial PRIMARY KEY
);
`,
      'utf-8',
    )

    const logOutput: string[] = []
    const consoleSpy = mockMethod(console, 'log', (...args: any[]) => {
      logOutput.push(args.map(String).join(' '))
    })

    const { validateCommand } = await import('../commands/validate.ts')
    const { CliError } = await import('../errors.ts')
    await expect(validateCommand(sqlFile, {})).rejects.toThrow(CliError)

    // Check that at least one output line matches the file:line:col format
    const diagLine = logOutput.find((l) => l.includes(sqlFile) && l.includes(':1:'))
    expect(diagLine).toBeTruthy()
    expect(diagLine).toContain('error')
    expect(diagLine).toContain("Unknown namespace '@unknown'")

    consoleSpy.restore()
  })
})
