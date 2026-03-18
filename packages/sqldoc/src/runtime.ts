/**
 * Runtime detection for the sqldoc shim.
 * Works on both Node and Bun, compiled and uncompiled.
 */

import { execSync } from 'node:child_process'

/** Whether we're running as a Bun-compiled binary */
export function isCompiledBinary(): boolean {
  return process.execPath.includes('sqldoc') && typeof (globalThis as any).Bun !== 'undefined'
}

/**
 * Get the command to run package installs.
 * Compiled binary: uses BUN_BE_BUN to invoke itself as bun.
 * Dev mode: uses the detected package manager.
 */
export function getPackageManagerCommand(_sqldocDir: string): { cmd: string; env?: Record<string, string> } {
  if (isCompiledBinary()) {
    return {
      cmd: process.execPath,
      env: { BUN_BE_BUN: '1' },
    }
  }

  // Dev mode — use whatever is available
  try {
    execSync('bun --version', { stdio: 'ignore' })
    return { cmd: 'bun' }
  } catch {}

  try {
    execSync('pnpm --version', { stdio: 'ignore' })
    return { cmd: 'pnpm' }
  } catch {}

  return { cmd: 'npm' }
}
