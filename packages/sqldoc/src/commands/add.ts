import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import pc from 'picocolors'
import { detectPM } from '../detect-pm.ts'
import { generateConfigTypes } from '../generate-config-types.ts'
import { isCompiledBinary } from '../runtime.ts'

/**
 * Install packages into .sqldoc/node_modules.
 */
export function addCommand(sqldocDir: string, packages: string[]): void {
  if (packages.length === 0) {
    console.error(pc.red('Error: No packages specified'))
    console.error(`Usage: ${pc.cyan('sqldoc add <package> [package...]')}`)
    process.exit(1)
  }

  const installArgs = isCompiledBinary()
    ? [process.execPath, 'install', ...packages]
    : (() => {
        const projectRoot = dirname(sqldocDir)
        const pm = detectPM(projectRoot)
        console.log(pc.dim(`Installing ${packages.join(', ')} with ${pm}...`))
        return pm === 'yarn' ? ['yarn', 'add', ...packages] : [pm, 'install', ...packages]
      })()

  const env = isCompiledBinary() ? { ...process.env, BUN_BE_BUN: '1' } : process.env

  if (isCompiledBinary()) {
    console.log(pc.dim(`Installing ${packages.join(', ')} with built-in package manager...`))
  }

  const result = spawnSync(installArgs[0], installArgs.slice(1), {
    cwd: sqldocDir,
    stdio: 'inherit',
    env,
  })

  if (result.status === 0) {
    generateConfigTypes(sqldocDir)
    console.log(pc.dim('Updated .sqldoc/config.d.ts'))
  }

  process.exit(result.status ?? 1)
}
