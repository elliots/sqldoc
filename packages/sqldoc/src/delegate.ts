import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import pc from 'picocolors'

import { addPackages } from './arborist.ts'

// Passed from index.ts — avoid circular import of package.json
let shimVersion = ''
export function setShimVersion(version: string): void {
  shimVersion = version
}

/** Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b. */
function semverCompare(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1
  }
  return 0
}

/** Check if the installed CLI requires a newer shim version. */
function checkVersion(sqldocDir: string): void {
  try {
    const cliPkg = JSON.parse(readFileSync(join(sqldocDir, 'node_modules', '@sqldoc', 'cli', 'package.json'), 'utf-8'))
    const minShimVersion = cliPkg.sqldoc?.minShimVersion
    if (minShimVersion && shimVersion && semverCompare(shimVersion, minShimVersion) < 0) {
      console.error(
        pc.yellow(
          `Warning: @sqldoc/cli@${cliPkg.version} recommends sqldoc binary >= ${minShimVersion} (you have ${shimVersion})`,
        ),
      )
      console.error(pc.yellow('Update with: brew upgrade sqldoc'))
    }
  } catch {}
}

/**
 * Enable TypeScript type stripping for .ts files under node_modules/.
 * Node's built-in stripping skips node_modules, so we handle it ourselves:
 * - CJS: custom Module._extensions['.ts'] handler using amaro
 * - ESM: register amaro/strip loader hook for transitive imports
 */
export function enableNodeModulesTypeStripping(): void {
  // Bun handles TypeScript natively — no stripping needed
  if (process.versions.bun) return

  // CJS require() handler — uses bundled amaro for type stripping
  const Module = require('node:module')
  const { stripTypeScriptTypes, register } = Module
  Module._extensions['.ts'] = (module: any, filename: string) => {
    const content = readFileSync(filename, 'utf-8')
    const code = stripTypeScriptTypes(content, { mode: 'strip' })
    module._compile(code, filename)
  }

  // ESM: register a loader hook for transitive ESM imports of .ts under node_modules.
  // Uses Node's built-in stripTypeScriptTypes (bypasses the node_modules restriction).
  const loaderCode = [
    'process.removeAllListeners("warning");',
    'import { stripTypeScriptTypes } from "node:module";',
    'export async function load(url, context, nextLoad) {',
    '  if (url.endsWith(".ts") && url.includes("node_modules")) {',
    '    const result = await nextLoad(url, context);',
    '    const source = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);',
    '    const stripped = stripTypeScriptTypes(source, { mode: "strip" });',
    '    return { format: "module", source: stripped, shortCircuit: true };',
    '  }',
    '  return nextLoad(url, context);',
    '}',
  ].join('\n')
  register(`data:text/javascript,${encodeURIComponent(loaderCode)}`)

  // Suppress experimental warnings from the loader hooks thread and worker threads
  process.execArgv.push('--no-warnings')
}

/**
 * Delegate command execution to the project-local @sqldoc/cli.
 * Runs in-process via require() so the CLI shares the same
 * @sqldoc/core module instance (and its package installer hook).
 */
export async function delegate(sqldocDir: string, args: string[]): Promise<void> {
  const nodeModules = join(sqldocDir, 'node_modules')

  // Verify CLI is installed
  if (!existsSync(join(nodeModules, '@sqldoc', 'cli', 'package.json'))) {
    console.error(pc.red('Error: @sqldoc/cli not found in .sqldoc/node_modules'))
    console.error(`Run: ${pc.cyan('sqldoc init')}`)
    process.exit(1)
  }

  checkVersion(sqldocDir)

  // Enable .ts type stripping for files under node_modules/
  enableNodeModulesTypeStripping()

  // Set environment for the CLI
  const projectRoot = dirname(sqldocDir)
  process.env.SQLDOC_PROJECT_ROOT = projectRoot
  process.env.NODE_PATH = nodeModules

  // Rewrite process.argv so Commander picks up the right args
  process.argv = [process.execPath, 'sqldoc', ...args]

  // Create a require function that loads from the filesystem (required for SEA binaries)
  // and resolves packages from .sqldoc/node_modules
  const localRequire = createRequire(join(nodeModules, '.package.json'))

  // Require core and set the package installer.
  // This must happen BEFORE requiring the CLI so they share the same core instance.
  const core = localRequire('@sqldoc/core')
  if (typeof core.setPackageInstaller === 'function') {
    core.setPackageInstaller(async (sqldocDir: string, packages: string[]) => {
      await addPackages(sqldocDir, packages)
    })
  }

  // Require the CLI module (side-effect-free) and call run() to parse argv
  const cli = localRequire('@sqldoc/cli')
  cli.run()
}
