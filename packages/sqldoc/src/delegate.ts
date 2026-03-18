import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import pc from 'picocolors'

/**
 * Delegate command execution to the project-local @sqldoc/cli.
 * Spawns the local CLI with inherited stdio and SQLDOC_PROJECT_ROOT env var.
 */
export function delegate(sqldocDir: string, args: string[]): void {
  // Try src/index.ts first (Bun runtime can execute .ts directly)
  let localCli = join(sqldocDir, 'node_modules', '@sqldoc', 'cli', 'src', 'index.ts')
  if (!existsSync(localCli)) {
    // Fallback to dist/index.js (for pre-built npm packages)
    localCli = join(sqldocDir, 'node_modules', '@sqldoc', 'cli', 'dist', 'index.js')
  }

  if (!existsSync(localCli)) {
    console.error(pc.red('Error: @sqldoc/cli not found in .sqldoc/node_modules'))
    console.error(`Run: ${pc.cyan('sqldoc init')}`)
    process.exit(1)
  }

  const projectRoot = dirname(sqldocDir)
  const child = spawn(process.execPath, [localCli, ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: {
      ...process.env,
      SQLDOC_PROJECT_ROOT: projectRoot,
      BUN_BE_BUN: '1',
      NODE_PATH: join(sqldocDir, 'node_modules'),
    },
  })

  child.on('exit', (code) => {
    process.exit(code ?? 1)
  })

  child.on('error', (err) => {
    console.error(pc.red(`Failed to start @sqldoc/cli: ${err.message}`))
    process.exit(1)
  })
}
