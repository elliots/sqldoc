import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'

import type { ImportError } from '@sqldoc/core'
import { findSqldocDir, installPackages, loadImports } from '@sqldoc/core'
import pc from 'picocolors'

// Re-export for use by pipeline.ts and schema.ts
export { installPackages }

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
  // Non-interactive (piped stdin) — auto-install known @sqldoc packages, skip unknown
  if (!process.stdin.isTTY) {
    if (packages.every((p) => p.startsWith('@sqldoc/'))) {
      console.error(pc.dim(`Auto-installing ${packages.join(', ')}...`))
      return true
    }
    return false
  }

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
 * Check for missing package errors, prompt the user to install, and retry loadImports.
 * Uses the package installer set by the sqldoc binary (via @sqldoc/core).
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
    try {
      console.error(pc.dim(`Installing ${missingPackages.join(', ')}...`))
      await installPackages(sqldocDir, missingPackages)
      // Retry loading after install
      return await loadImports(importPaths, filePath)
    } catch (err: any) {
      console.error(pc.red(`Failed to install: ${err.message}`))
    }
  }

  return null
}
