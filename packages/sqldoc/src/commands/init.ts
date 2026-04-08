import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import pc from 'picocolors'

import { addPackages } from '../arborist.ts'
import { generateConfigTypes } from '../generate-config-types.ts'
import { createRL, promptConfirm } from '../prompt.ts'

function findLocalPackages(repoPath: string): Array<{ name: string; path: string }> {
  const packagesDir = join(repoPath, 'packages')
  if (!existsSync(packagesDir)) return []

  const packages: Array<{ name: string; path: string }> = []
  for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const pkgPath = join(packagesDir, dir.name, 'package.json')
    if (!existsSync(pkgPath)) continue
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      if (pkg.name?.startsWith('@sqldoc/')) {
        packages.push({ name: pkg.name, path: join(packagesDir, dir.name) })
      }
    } catch {}
  }
  return packages
}

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

const DEFAULT_CONFIG = `import type { Config } from './.sqldoc/config'

export default {
  dialect: 'postgres',
  schema: 'schema/',
  migrations: {
    dir: 'migrations/',
    format: 'plain',
  },
  namespaces: {
    docs: {
      format: 'html',
      output: 'docs/schema.html',
    },
  },
} satisfies Config
`

/**
 * Initialize a .sqldoc/ project directory.
 *
 * --dev <path>: link all @sqldoc/* packages from a local monorepo.
 * Otherwise: installs @sqldoc/cli and @sqldoc/ns-docs from npm.
 */
export async function initCommand(targetDir: string = process.cwd(), devPath?: string): Promise<void> {
  const sqldocDir = join(targetDir, '.sqldoc')

  if (existsSync(sqldocDir)) {
    console.error(pc.red('Error: .sqldoc/ already exists in this directory'))
    process.exit(1)
  }

  console.log(pc.cyan('Initializing .sqldoc/ project...'))
  console.log('')

  mkdirSync(sqldocDir, { recursive: true })
  writeFileSync(join(sqldocDir, '.gitignore'), 'node_modules/\nneon-temporary.json\n')

  if (devPath) {
    // Dev mode — link all @sqldoc/* packages from local repo
    const repoPath = resolve(devPath)
    if (!existsSync(repoPath)) {
      console.error(pc.red(`Error: ${repoPath} does not exist`))
      process.exit(1)
    }

    const localPackages = findLocalPackages(repoPath)
    if (localPackages.length === 0) {
      console.error(pc.red(`No @sqldoc/* packages found in ${repoPath}/packages/`))
      process.exit(1)
    }

    const deps: Record<string, string> = {}
    for (const pkg of localPackages) {
      const relPath = relative(sqldocDir, pkg.path)
      deps[pkg.name] = `file:${relPath}`
    }

    writeFileSync(
      join(sqldocDir, 'package.json'),
      `${JSON.stringify({ name: 'sqldoc-local', private: true, workspaces: [], dependencies: deps }, null, 2)}\n`,
    )

    const nmDir = join(sqldocDir, 'node_modules', '@sqldoc')
    mkdirSync(nmDir, { recursive: true })
    for (const pkg of localPackages) {
      const linkName = pkg.name.replace('@sqldoc/', '')
      const linkPath = join(nmDir, linkName)
      try {
        symlinkSync(pkg.path, linkPath)
      } catch (e: any) {
        if (e.code !== 'EEXIST') throw e
      }
    }

    console.log(pc.dim(`Linked ${localPackages.length} packages from ${repoPath}`))
  } else {
    // Production mode — install @sqldoc/cli first, then pin ns-docs to same version
    writeFileSync(
      join(sqldocDir, 'package.json'),
      `${JSON.stringify({ name: 'sqldoc-local', private: true, workspaces: [] }, null, 2)}\n`,
    )

    console.log(pc.dim('Installing @sqldoc/cli...'))
    await addPackages(sqldocDir, ['@sqldoc/cli@latest'])

    const cliVersion = getInstalledCliVersion(sqldocDir)
    if (!cliVersion) {
      console.error(pc.red('Failed to install @sqldoc/cli'))
      process.exit(1)
    }

    console.log(pc.dim(`Installed @sqldoc/cli@${cliVersion}, installing @sqldoc/ns-docs...`))
    await addPackages(sqldocDir, [`@sqldoc/ns-docs@${cliVersion}`])
  }

  // Generate config types
  generateConfigTypes(sqldocDir)

  // Scaffold sqldoc.config.ts
  const configPath = join(targetDir, 'sqldoc.config.ts')
  if (!existsSync(configPath)) {
    let createConfig = true
    if (process.stdin.isTTY && !process.env.NODE_TEST_CONTEXT && process.env.NODE_ENV !== 'test') {
      const rl = createRL()
      createConfig = await promptConfirm(rl, 'Create sqldoc.config.ts?')
      rl.close()
    }
    if (createConfig) {
      writeFileSync(configPath, DEFAULT_CONFIG)
      console.log(`  ${pc.green('+')} ${pc.bold('sqldoc.config.ts')}`)
    }
  }

  console.log('')
  console.log(pc.green('Project initialized!'))
  console.log('')
  console.log('Next steps:')
  console.log(`  ${pc.cyan('sqldoc codegen')}                 Generate docs and code from your schema`)
  console.log(`  ${pc.cyan('sqldoc schema inspect')}          View the parsed schema`)
  console.log(`  ${pc.cyan('sqldoc migrate')}                 Generate a migration file`)
  console.log('')
  console.log('Install more plugins:')
  console.log(`  ${pc.cyan('sqldoc add @sqldoc/ns-audit')}    Audit trail triggers`)
  console.log(`  ${pc.cyan('sqldoc add @sqldoc/ns-validate')} CHECK constraints from tags`)
  console.log(`  ${pc.cyan('sqldoc add @sqldoc/ns-rls')}      Row-level security policies`)
  console.log(`  ${pc.cyan('sqldoc add @sqldoc/templates')}   Code generation (TypeScript, Go, etc.)`)
}
