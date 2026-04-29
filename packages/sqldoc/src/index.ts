import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'

import pc from 'picocolors'
import packageJson from '../package.json' with { type: 'json' }
import { installDeps } from './arborist.ts'
import { addCommand } from './commands/add.ts'
import { initCommand } from './commands/init.ts'
import { installCommand } from './commands/install.ts'
import { upgradeCommand } from './commands/upgrade.ts'
import { delegate, enableNodeModulesTypeStripping, setShimVersion } from './delegate.ts'
import { findSqldocDir } from './find-sqldoc.ts'

const VERSION = packageJson.version
setShimVersion(VERSION)

type CommandInfo = {
  name: string
  description: string
  subcommands?: CommandInfo[]
}

/** Discover commands from the project-local @sqldoc/cli in-process. */
function discoverCliCommands(sqldocDir: string): CommandInfo[] | null {
  const nodeModules = path.join(sqldocDir, 'node_modules')
  const cliPkg = path.join(nodeModules, '@sqldoc', 'cli', 'package.json')
  if (!fs.existsSync(cliPkg)) return null

  try {
    enableNodeModulesTypeStripping()
    const localRequire = createRequire(path.join(nodeModules, '.package.json'))
    const cli = localRequire('@sqldoc/cli')
    if (typeof cli.getCommandInfo !== 'function') {
      console.error(
        pc.yellow('Warning: installed @sqldoc/cli does not export getCommandInfo — update with: sqldoc upgrade'),
      )
      return null
    }
    return cli.getCommandInfo() as CommandInfo[]
  } catch (err: any) {
    console.error(pc.yellow(`Warning: failed to load CLI commands: ${err?.message ?? String(err)}`))
    return null
  }
}

function buildHelp(): string {
  const sqldocDir = findSqldocDir()

  const lines: string[] = [
    `${pc.bold('sqldoc')} - SQL documentation and code generation`,
    '',
    `${pc.dim('Usage:')}`,
    '  sqldoc <command> [options]',
    '',
    `${pc.dim('Commands:')}`,
    '  init                 Initialize .sqldoc/ in the current directory',
    '  install              Install dependencies from .sqldoc/package.json',
    '  add <packages...>    Install packages into .sqldoc/',
    '  upgrade              Update all packages in .sqldoc/',
  ]

  const cliCommands = sqldocDir ? discoverCliCommands(sqldocDir) : null
  if (cliCommands) {
    for (const cmd of cliCommands) {
      lines.push(`  ${cmd.name.padEnd(19)} ${cmd.description}`)
      if (cmd.subcommands) {
        for (const sub of cmd.subcommands) {
          lines.push(`··${`${cmd.name}·${sub.name}`.padEnd(19)}·${sub.description}`)
        }
      }
    }
  }

  lines.push(
    '',
    `${pc.dim('Options:')}`,
    '  --version, -V        Show version',
    '  --help, -h           Show this help',
  )

  return lines.join('\n')
}

/** Run install in .sqldoc/ to ensure node_modules is up to date */
async function ensureDeps(sqldocDir: string): Promise<void> {
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

  try {
    await installDeps(sqldocDir)
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
    console.log(`${VERSION} (node ${process.version})`)
    return
  }

  if (command === '--help' || command === '-h') {
    console.log(buildHelp())
    return
  }

  // Handle built-in commands
  if (command === 'init') {
    const devIdx = args.indexOf('--dev')
    const devPath = devIdx !== -1 ? args[devIdx + 1] : undefined
    await initCommand(process.cwd(), devPath)
    return
  }

  if (command === 'install') {
    const sqldocDir = requireSqldocDir()
    await installCommand(sqldocDir)
    return
  }

  if (command === 'add') {
    const sqldocDir = requireSqldocDir()
    await addCommand(sqldocDir, args.slice(1))
    return
  }

  if (command === 'upgrade') {
    const sqldocDir = requireSqldocDir()
    await upgradeCommand(sqldocDir)
    return
  }

  // No command given → show help
  if (!command) {
    console.log(buildHelp())
    return
  }

  // Default: ensure dependencies are installed, then delegate
  const sqldocDir = requireSqldocDir()
  await ensureDeps(sqldocDir)
  await delegate(sqldocDir, args)
}

main().catch((err) => {
  console.error(pc.red(err.message))
  process.exit(1)
})
