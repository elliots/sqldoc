import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import type { ImportError } from '@sqldoc/core'
import { findSqldocDir, loadImports } from '@sqldoc/core'
import pc from 'picocolors'

/**
 * Detect missing npm packages from loadImport errors.
 * Returns an array of package names that look like "Cannot find module/package"
 * for npm scoped/unscoped packages (not relative paths).
 */
export function extractMissingPackages(errors: ImportError[]): string[] {
  const missing: string[] = []
  for (const err of errors) {
    if (
      /cannot find (module|package)/i.test(err.message) &&
      !err.importPath.startsWith('.') &&
      !err.importPath.startsWith('/')
    ) {
      missing.push(err.importPath)
    }
  }
  return [...new Set(missing)]
}

/**
 * Prompt the user via stdin whether to install missing packages.
 * Returns true if user agrees (Enter or 'y'/'Y').
 */
export async function promptInstall(packages: string[]): Promise<boolean> {
  // Non-interactive (piped stdin) — skip prompt
  if (!process.stdin.isTTY) return false

  const names = packages.map((p) => pc.cyan(p)).join(', ')
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  const answer = await new Promise<string>((resolve) =>
    rl.question(`Package ${names} is not installed. Install it? (Y/n) `, resolve),
  )
  rl.close()
  return answer === '' || answer.toLowerCase() === 'y'
}

/**
 * Find the .sqldoc/ directory, checking SQLDOC_PROJECT_ROOT first, then walking up from cwd.
 */
function findSqldocDirWithEnv(): string | null {
  const envRoot = process.env.SQLDOC_PROJECT_ROOT
  if (envRoot) {
    const candidate = path.join(envRoot, '.sqldoc')
    if (fs.existsSync(candidate)) return candidate
  }
  return findSqldocDir()
}

/**
 * Install packages into .sqldoc/node_modules using the same mechanism as `sqldoc add`.
 * Returns true if install succeeded.
 */
export function installPackages(sqldocDir: string, packages: string[]): boolean {
  // Detect if running as compiled Bun binary
  const isBunBinary = typeof (globalThis as any).Bun !== 'undefined' && !process.execPath.match(/\/(bun|node)(\.exe)?$/)

  let installArgs: string[]
  const env: Record<string, string> = { ...process.env } as Record<string, string>

  if (isBunBinary) {
    installArgs = [process.execPath, 'install', ...packages]
    env.BUN_BE_BUN = '1'
  } else {
    // Detect package manager from lockfiles
    const projectRoot = path.dirname(sqldocDir)
    let pm = 'npm'
    if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) pm = 'pnpm'
    else if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) pm = 'yarn'
    else if (fs.existsSync(path.join(projectRoot, 'bun.lockb')) || fs.existsSync(path.join(projectRoot, 'bun.lock')))
      pm = 'bun'

    installArgs = pm === 'yarn' ? ['yarn', 'add', ...packages] : [pm, 'install', ...packages]
  }

  console.error(pc.dim(`Installing ${packages.join(', ')}...`))
  const result = spawnSync(installArgs[0], installArgs.slice(1), {
    cwd: sqldocDir,
    stdio: 'inherit',
    env,
  })

  return result.status === 0
}

/**
 * Check for missing package errors, prompt the user to install, and retry loadImports.
 * Returns updated namespaces and remaining errors.
 */
export async function promptAndInstallMissing(
  loadErrors: ImportError[],
  importPaths: string[],
  filePath: string,
): Promise<{ namespaces: Map<string, any>; errors: ImportError[] } | null> {
  const missingPackages = extractMissingPackages(loadErrors)
  if (missingPackages.length === 0) return null

  const sqldocDir = findSqldocDirWithEnv()
  if (!sqldocDir) return null

  if (await promptInstall(missingPackages)) {
    if (installPackages(sqldocDir, missingPackages)) {
      // Retry loading after install
      return await loadImports(importPaths, filePath)
    }
  }

  return null
}
