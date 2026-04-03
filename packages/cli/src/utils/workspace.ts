import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { findSqldocDir } from '@sqldoc/core'
import pc from 'picocolors'
import { CliError } from '../errors.ts'

const CONFIG_PATTERN = /^sqldoc\.config(\.\w+)?\.[tj]s$/

/**
 * Find all sqldoc config files in the workspace, respecting .gitignore.
 * Returns absolute paths sorted by directory depth then alphabetically.
 */
export function findAllConfigs(): string[] {
  const sqldocDir = findSqldocDir(process.cwd())
  if (!sqldocDir) {
    throw new CliError('No .sqldoc directory found. Run sqldoc init first.')
  }
  const projectRoot = path.dirname(sqldocDir)

  // Use git ls-files to respect .gitignore
  let trackedFiles: string[]
  try {
    const output = execSync('git ls-files --cached --others --exclude-standard', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    trackedFiles = output.trim().split('\n').filter(Boolean)
  } catch {
    // Not a git repo — fall back to recursive search
    trackedFiles = walkDir(projectRoot)
  }

  const configs = trackedFiles
    .filter((f) => CONFIG_PATTERN.test(path.basename(f)))
    .map((f) => path.resolve(projectRoot, f))
    .filter((f) => fs.existsSync(f))
    .sort((a, b) => {
      const depthA = a.split(path.sep).length
      const depthB = b.split(path.sep).length
      return depthA !== depthB ? depthA - depthB : a.localeCompare(b)
    })

  return configs
}

/**
 * Run a command action for each config file in the workspace.
 * Displays per-config status and collects results.
 */
export async function runForAllConfigs(
  commandName: string,
  action: (configPath: string) => Promise<void>,
): Promise<void> {
  const configs = findAllConfigs()

  if (configs.length === 0) {
    throw new CliError('No sqldoc config files found in workspace.')
  }

  const sqldocDir = findSqldocDir(process.cwd())!
  const projectRoot = path.dirname(sqldocDir)

  console.error(pc.cyan(`Running ${commandName} across ${configs.length} config(s):\n`))

  let passed = 0
  let failed = 0

  for (const configPath of configs) {
    const relative = path.relative(projectRoot, configPath)
    console.error(pc.dim(`── ${relative}`))

    try {
      await action(configPath)
      passed++
    } catch (err: any) {
      failed++
      const msg = err instanceof CliError ? err.message : (err?.message ?? String(err))
      console.error(pc.red(`   Error: ${msg}`))
    }
  }

  console.error('')
  if (failed > 0) {
    console.error(pc.red(`${failed} of ${configs.length} config(s) failed`))
    throw new CliError(`${commandName} --all: ${failed} failure(s)`, 1)
  }
  console.error(pc.green(`${passed} config(s) completed successfully`))
}

/** Simple recursive directory walk (fallback when not in a git repo) */
function walkDir(dir: string, results: string[] = [], root = dir): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkDir(full, results, root)
    } else {
      results.push(path.relative(root, full))
    }
  }
  return results
}
