import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import pc from 'picocolors'
import { detectPM } from '../detect-pm.ts'
import { generateConfigTypes } from '../generate-config-types.ts'

function isCompiledBinary(): boolean {
  return typeof process.versions?.bun === 'string' && !process.execPath.match(/\/(bun|node)(\.exe)?$/)
}

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

function installPackages(sqldocDir: string, targetDir: string, packages: string[]): boolean {
  const installArgs = isCompiledBinary()
    ? [process.execPath, 'install', ...packages]
    : (() => {
        const pm = detectPM(targetDir)
        console.log(pc.dim(`Using ${pm} to install ${packages.join(', ')}...`))
        return pm === 'yarn' ? ['yarn', 'add', ...packages] : [pm, 'install', ...packages]
      })()

  const env = isCompiledBinary() ? { ...process.env, BUN_BE_BUN: '1' } : process.env

  if (isCompiledBinary()) {
    console.log(pc.dim('Using built-in package manager...'))
  }

  const result = spawnSync(installArgs[0], installArgs.slice(1), {
    cwd: sqldocDir,
    stdio: 'inherit',
    env,
  })

  return result.status === 0
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

const EXAMPLE_SCHEMA = `-- @import '@sqldoc/ns-docs'

-- @docs.description('Application users')
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,

    -- @docs.description('Login email address')
    email TEXT NOT NULL UNIQUE,

    -- @docs.description('Display name')
    name TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @docs.description('User-created posts')
CREATE TABLE posts (
    id BIGSERIAL PRIMARY KEY,

    -- @docs.description('Author of the post')
    user_id BIGINT NOT NULL REFERENCES users(id),

    title TEXT NOT NULL,
    body TEXT,
    published BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
    // Production mode — install @sqldoc/cli and ns-docs
    writeFileSync(
      join(sqldocDir, 'package.json'),
      `${JSON.stringify({ name: 'sqldoc-local', private: true, workspaces: [] }, null, 2)}\n`,
    )

    // DB adapter plugins are auto-installed on first use by the CLI
    if (!installPackages(sqldocDir, targetDir, ['@sqldoc/cli', '@sqldoc/ns-docs'])) {
      console.error(pc.red('Failed to install packages'))
      process.exit(1)
    }
  }

  // Generate config types
  generateConfigTypes(sqldocDir)

  // Scaffold sqldoc.config.ts
  const configPath = join(targetDir, 'sqldoc.config.ts')
  if (!existsSync(configPath)) {
    writeFileSync(configPath, DEFAULT_CONFIG)
    console.log(`  ${pc.green('+')} ${pc.bold('sqldoc.config.ts')}`)
  }

  // Scaffold example schema if schema/ doesn't exist
  const schemaDir = join(targetDir, 'schema')
  if (!existsSync(schemaDir)) {
    mkdirSync(schemaDir, { recursive: true })
    writeFileSync(join(schemaDir, 'schema.sql'), EXAMPLE_SCHEMA)
    console.log(`  ${pc.green('+')} ${pc.bold('schema/schema.sql')} ${pc.dim('(example schema with two tables)')}`)
  }

  console.log('')
  console.log(pc.green('Project initialized!'))
  console.log('')
  console.log(`Edit ${pc.bold('sqldoc.config.ts')} to configure your project.`)
  console.log(`We've created an example schema in ${pc.bold('schema/')} to get you started.`)
  console.log('')
  console.log('Try these commands:')
  console.log(`  ${pc.cyan('sqldoc codegen')}                 Generate HTML docs from your schema`)
  console.log(`  ${pc.cyan('sqldoc schema inspect')}          View the parsed schema`)
  console.log(`  ${pc.cyan('sqldoc migrate')}                 Generate a migration file`)
  console.log('')
  console.log('Install more plugins:')
  console.log(`  ${pc.cyan('sqldoc add @sqldoc/ns-audit')}    Audit trail triggers`)
  console.log(`  ${pc.cyan('sqldoc add @sqldoc/ns-validate')} CHECK constraints from tags`)
  console.log(`  ${pc.cyan('sqldoc add @sqldoc/ns-rls')}      Row-level security policies`)
  console.log(`  ${pc.cyan('sqldoc add @sqldoc/templates')}   Code generation (TypeScript, Go, etc.)`)
}
