import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

/**
 * Detect the package manager used in a project by checking lockfiles.
 * Priority: pnpm > yarn > bun > npm (fallback).
 */
export function detectPM(projectRoot: string): PackageManager {
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(projectRoot, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(projectRoot, 'bun.lockb'))) return 'bun'
  if (existsSync(join(projectRoot, 'bun.lock'))) return 'bun'
  if (existsSync(join(projectRoot, 'package-lock.json'))) return 'npm'
  return 'npm'
}
