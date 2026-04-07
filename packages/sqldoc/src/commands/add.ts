import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import pc from 'picocolors'

import { addPackages } from '../arborist.ts'
import { generateConfigTypes } from '../generate-config-types.ts'

/** Read the installed version of @sqldoc/cli from node_modules. */
function getInstalledCliVersion(sqldocDir: string): string | null {
  const pkgPath = join(sqldocDir, 'node_modules', '@sqldoc', 'cli', 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version
  } catch {
    return null
  }
}

/**
 * Install packages into .sqldoc/node_modules.
 * @sqldoc/* packages are pinned to the installed CLI version.
 */
export async function addCommand(sqldocDir: string, packages: string[]): Promise<void> {
  if (packages.length === 0) {
    console.error(pc.red('Error: No packages specified'))
    console.error(`Usage: ${pc.cyan('sqldoc add <package> [package...]')}`)
    process.exit(1)
  }

  // Pin @sqldoc/* packages to the installed CLI version
  const cliVersion = getInstalledCliVersion(sqldocDir)
  const hasSqldocPackages = packages.some((pkg) => pkg.startsWith('@sqldoc/') && !pkg.includes('@', 1))
  if (hasSqldocPackages && !cliVersion) {
    console.error(pc.red('Error: @sqldoc/cli is not installed. Run sqldoc init first.'))
    process.exit(1)
  }

  const resolved = packages.map((pkg) => {
    if (pkg.startsWith('@sqldoc/') && !pkg.includes('@', 1)) {
      return `${pkg}@${cliVersion}`
    }
    return pkg
  })

  console.log(pc.dim(`Installing ${packages.join(', ')}...`))

  try {
    await addPackages(sqldocDir, resolved)
    generateConfigTypes(sqldocDir)
    console.log(pc.dim('Updated .sqldoc/config.d.ts'))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(pc.red(`Failed to install: ${msg}`))
    process.exit(1)
  }
}
