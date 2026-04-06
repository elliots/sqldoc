/**
 * Package installation hook.
 * The sqldoc binary sets this to use @npmcli/arborist.
 * Other callers (CLI auto-install) use it without knowing the implementation.
 */

export type PackageInstaller = (sqldocDir: string, packages: string[]) => Promise<void>

let installer: PackageInstaller | null = null

/** Set the package installer implementation. Called by the sqldoc binary. */
export function setPackageInstaller(fn: PackageInstaller): void {
  installer = fn
}

/** Install packages into a .sqldoc/ directory. Throws if no installer is configured. */
export async function installPackages(sqldocDir: string, packages: string[]): Promise<void> {
  if (!installer) {
    throw new Error('No package installer configured. Are you running via the sqldoc binary?')
  }
  await installer(sqldocDir, packages)
}
