/**
 * CLI test helpers for E2E tests.
 *
 * Provides `runCli`, `runShim`, and `initProject` so integration tests
 * don't each re-implement the same child-process wrappers.
 */

import { execSync, spawnSync } from 'node:child_process'
import * as path from 'node:path'

export const MONOREPO_ROOT = path.resolve(import.meta.dirname, '../../..')
export const CLI_ENTRY = path.join(MONOREPO_ROOT, 'packages/cli/src/index.ts')
export const SHIM_ENTRY = path.join(MONOREPO_ROOT, 'packages/sqldoc/src/index.ts')

export function runCli(
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

export function runShim(
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

export function initProject(tmpDir: string): void {
  runShim(`init --dev ${MONOREPO_ROOT}`, tmpDir)
}
