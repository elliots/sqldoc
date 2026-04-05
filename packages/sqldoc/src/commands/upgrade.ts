import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import pc from 'picocolors'
import { detectPM } from '../detect-pm.ts'
import { isCompiledBinary } from '../runtime.ts'

/**
 * Upgrade all packages in .sqldoc/node_modules.
 */
export function upgradeCommand(sqldocDir: string): void {
  const upgradeArgs = isCompiledBinary()
    ? [process.execPath, 'update']
    : (() => {
        const projectRoot = dirname(sqldocDir)
        const pm = detectPM(projectRoot)
        console.log(pc.dim(`Upgrading packages with ${pm}...`))
        switch (pm) {
          case 'pnpm':
            return ['pnpm', 'update']
          case 'yarn':
            return ['yarn', 'upgrade']
          case 'bun':
            return ['bun', 'update']
          default:
            return ['npm', 'update']
        }
      })()

  const env = isCompiledBinary() ? { ...process.env, BUN_BE_BUN: '1' } : process.env

  if (isCompiledBinary()) {
    console.log(pc.dim('Upgrading packages with built-in package manager...'))
  }

  const result = spawnSync(upgradeArgs[0], upgradeArgs.slice(1), {
    cwd: sqldocDir,
    stdio: 'inherit',
    env,
  })

  process.exit(result.status ?? 1)
}
