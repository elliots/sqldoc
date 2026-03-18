import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import pc from 'picocolors'
import { addCommand } from './commands/add.ts'
import { initCommand } from './commands/init.ts'
import { upgradeCommand } from './commands/upgrade.ts'
import { delegate } from './delegate.ts'
import { findSqldocDir } from './find-sqldoc.ts'
import { getPackageManagerCommand } from './runtime.ts'

// Version is set at build time — the compiled binary can't read package.json
const VERSION = '0.0.1'

const HELP = `
${pc.bold('sqldoc')} - SQL documentation and code generation

${pc.dim('Usage:')}
  sqldoc <command> [options]

${pc.dim('Built-in commands:')}
  init                 Initialize .sqldoc/ in the current directory
  add <packages...>    Install packages into .sqldoc/node_modules
  upgrade              Update all packages in .sqldoc/

${pc.dim('Options:')}
  --version, -V        Show version
  --help, -h           Show this help

All other commands are delegated to the project-local @sqldoc/cli
installed in .sqldoc/node_modules/@sqldoc/cli.
`.trim()

/** Run install in .sqldoc/ to ensure node_modules is up to date */
function ensureDeps(sqldocDir: string): void {
  const nodeModules = path.join(sqldocDir, 'node_modules')
  const pkgJson = path.join(sqldocDir, 'package.json')

  // Skip if no package.json
  if (!fs.existsSync(pkgJson)) return

  // Dev mode uses symlinks — no install needed
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'))
    if (pkg.description?.includes('dev mode')) return
  } catch {}

  // Quick check: if node_modules exists and is newer than package.json, skip
  if (fs.existsSync(nodeModules)) {
    const pkgMtime = fs.statSync(pkgJson).mtimeMs
    const nmMtime = fs.statSync(nodeModules).mtimeMs
    if (nmMtime > pkgMtime) return
  }

  const pm = getPackageManagerCommand(sqldocDir)
  try {
    execSync(`${pm.cmd} install`, {
      cwd: sqldocDir,
      stdio: 'inherit',
      env: { ...process.env, ...pm.env },
    })
  } catch {
    console.error(pc.yellow('Warning: failed to sync .sqldoc/ dependencies'))
  }
}

function requireSqldocDir(): string {
  const sqldocDir = findSqldocDir()
  if (!sqldocDir) {
    console.error(pc.red('Error: No .sqldoc/ directory found'))
    console.error(`Run ${pc.cyan('sqldoc init')} to create one.`)
    process.exit(1)
  }
  return sqldocDir
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  // Handle flags
  if (command === '--version' || command === '-V') {
    console.log(VERSION)
    return
  }

  if (command === '--help' || command === '-h') {
    console.log(HELP)
    return
  }

  // Handle built-in commands
  if (command === 'init') {
    const devIdx = args.indexOf('--dev')
    const devPath = devIdx !== -1 ? args[devIdx + 1] : undefined
    await initCommand(process.cwd(), devPath)
    return
  }

  if (command === 'add') {
    const sqldocDir = requireSqldocDir()
    addCommand(sqldocDir, args.slice(1))
    return
  }

  if (command === 'upgrade') {
    const sqldocDir = requireSqldocDir()
    upgradeCommand(sqldocDir)
    return
  }

  // No command given → show help
  if (!command) {
    console.log(HELP)
    return
  }

  // Default: ensure dependencies are installed, then delegate
  const sqldocDir = requireSqldocDir()
  ensureDeps(sqldocDir)
  delegate(sqldocDir, args)
}

main().catch((err) => {
  console.error(pc.red(err.message))
  process.exit(1)
})
