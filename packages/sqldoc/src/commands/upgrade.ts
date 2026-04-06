import pc from 'picocolors'

import { updateAll } from '../arborist.ts'

/**
 * Upgrade all packages in .sqldoc/node_modules.
 */
export async function upgradeCommand(sqldocDir: string): Promise<void> {
  console.log(pc.dim('Upgrading packages...'))

  try {
    await updateAll(sqldocDir)
    console.log(pc.green('Packages upgraded successfully'))
  } catch (err: any) {
    console.error(pc.red(`Failed to upgrade: ${err.message}`))
    process.exit(1)
  }
}
