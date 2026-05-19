/**
 * CLI test helpers for E2E tests.
 *
 * Provides `runCli`, `runShim`, and `initProject` so integration tests
 * don't each re-implement the same child-process wrappers.
 */

import { spawnSync } from 'node:child_process'
import * as path from 'node:path'

export const MONOREPO_ROOT = path.resolve(import.meta.dirname, '../../..')
export const CLI_ENTRY = path.join(MONOREPO_ROOT, 'packages/cli/src/main.ts')
export const SHIM_ENTRY = path.join(MONOREPO_ROOT, 'packages/sqldoc/src/index.ts')
const TEST_RUNTIME_BIN = process.env.SQLDOC_TEST_RUNTIME_BIN ?? process.execPath

export function runCli(
  args: string,
  cwd: string,
  opts: { expectFail?: boolean; env?: Record<string, string> } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const { SQLDOC_RESOLVE_FROM_LOCAL_PACKAGE: _, ...parentEnv } = process.env
  const env = {
    ...parentEnv,
    SQLDOC_PROJECT_ROOT: cwd,
    NODE_PATH: path.join(cwd, '.sqldoc', 'node_modules'),
    NODE_NO_WARNINGS: '1',
    ...opts.env,
  }

  const result = spawnSync(TEST_RUNTIME_BIN, [CLI_ENTRY, ...args.split(/\s+/)], {
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
      `CLI command failed: ${TEST_RUNTIME_BIN} ${CLI_ENTRY} ${args}\n` +
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
  const result = spawnSync(TEST_RUNTIME_BIN, [SHIM_ENTRY, ...args.split(/\s+/)], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: 60_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const exitCode = result.status ?? 1

  if (exitCode !== 0 && !opts.expectFail) {
    throw new Error(
      `Shim command failed: ${TEST_RUNTIME_BIN} ${SHIM_ENTRY} ${args}\n` +
        `Exit code: ${exitCode}\n` +
        `stderr: ${stderr}`,
    )
  }

  return { stdout, stderr, exitCode }
}

export function initProject(tmpDir: string): void {
  runShim(`init --dev ${MONOREPO_ROOT}`, tmpDir)
}
