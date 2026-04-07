import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import pc from 'picocolors'

import { addPackages } from '../arborist.ts'

/**
 * Upgrade all @sqldoc/* packages in .sqldoc/node_modules to the latest CLI version.
 * Reads the current package.json, collects all @sqldoc/* deps,
 * then reinstalls them all at the latest @sqldoc/cli version.
 */
export async function upgradeCommand(sqldocDir: string): Promise<void> {
  // Read current deps
  const pkgPath = join(sqldocDir, 'package.json')
  let pkg: any
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(pc.red(`Failed to read ${pkgPath}: ${msg}`))
    process.exit(1)
  }
  const deps = pkg.dependencies ?? {}

  const sqldocPackages = Object.keys(deps).filter((name) => name.startsWith('@sqldoc/'))
  if (sqldocPackages.length === 0) {
    console.log(pc.yellow('No @sqldoc/* packages found in .sqldoc/'))
    return
  }

  try {
    // Install @sqldoc/cli@latest first to get the latest version
    console.log(pc.dim('Fetching latest @sqldoc/cli...'))
    await addPackages(sqldocDir, ['@sqldoc/cli@latest'])

    // Read the resolved version
    const cliPkgPath = join(sqldocDir, 'node_modules', '@sqldoc', 'cli', 'package.json')
    const cliVersion = JSON.parse(readFileSync(cliPkgPath, 'utf-8')).version

    // Upgrade all other @sqldoc/* packages to the same version
    const others = sqldocPackages.filter((name) => name !== '@sqldoc/cli')
    if (others.length > 0) {
      const pinned = others.map((name) => `${name}@${cliVersion}`)
      console.log(pc.dim(`Upgrading ${others.join(', ')} to ${cliVersion}...`))
      await addPackages(sqldocDir, pinned)
    }

    console.log(pc.green(`All packages upgraded to ${cliVersion}`))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(pc.red(`Failed to upgrade packages: ${msg}`))
    process.exit(1)
  }
}