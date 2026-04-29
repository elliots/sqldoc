import { existsSync } from 'node:fs'
import { join } from 'node:path'

import pc from 'picocolors'

import { installDeps } from '../arborist.ts'

/**
 * Install all packages declared in .sqldoc/package.json.
 * Equivalent to `npm install` inside .sqldoc/.
 */
export async function installCommand(sqldocDir: string): Promise<void> {
  const pkgPath = join(sqldocDir, 'package.json')
  if (!existsSync(pkgPath)) {
    console.error(pc.red(`Error: ${pkgPath} not found`))
    process.exit(1)
  }

  console.log(pc.dim(`Installing dependencies from ${pkgPath}...`))

  try {
    await installDeps(sqldocDir)
    console.log(pc.green('Dependencies installed'))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(pc.red(`Failed to install: ${msg}`))
    process.exit(1)
  }
}
