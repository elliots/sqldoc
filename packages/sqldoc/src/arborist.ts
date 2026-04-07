/**
 * Programmatic package management via @npmcli/arborist.
 * Used by the compiled SEA binary (which has no external package manager)
 * and in dev mode as a consistent alternative to shelling out.
 */

import Arborist from '@npmcli/arborist'

/** Ensure node_modules matches package.json (equivalent to `npm install`). */
export async function installDeps(sqldocDir: string): Promise<void> {
  const arb = new Arborist({ path: sqldocDir })
  await arb.reify()
}

/** Install packages into .sqldoc/ (equivalent to `npm install --save-exact pkg1 pkg2`). */
export async function addPackages(sqldocDir: string, packages: string[]): Promise<void> {
  const arb = new Arborist({ path: sqldocDir, savePrefix: '' })
  await arb.reify({ add: packages })
}
