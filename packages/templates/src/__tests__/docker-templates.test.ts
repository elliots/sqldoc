/**
 * Docker-based template tests.
 *
 * Auto-discovers templates by finding src/<template>/test/Dockerfile.
 * Starts a Postgres container on a shared Docker network, seeds it,
 * runs codegen (output goes directly into each test dir), then for each template:
 *   1. docker build  (typecheck / compile)
 *   2. docker run    (integration test or no-op CMD)
 *
 * Run with: bun test --timeout 180000 packages/templates/src/__tests__/docker-templates.test.ts
 *
 * Requires Docker. Skipped in the default test suite — run explicitly.
 */

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from '@sqldoc/test-utils'
import postgres from 'postgres'

const thisDir = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = resolve(thisDir, '../..')
const SRC_DIR = join(TEMPLATES_DIR, 'src')
const TEST_DIR = join(TEMPLATES_DIR, 'test')
const REPO_ROOT = resolve(TEMPLATES_DIR, '../..')

const NETWORK = 'sqldoc-test-net'
const PG_CONTAINER = 'sqldoc-test-pg'
const PG_PORT = 54321
const DB_URL = `postgresql://postgres:postgres@${PG_CONTAINER}:5432/postgres`

function discoverTemplates(): string[] {
  return readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SRC_DIR, d.name, 'test', 'Dockerfile')))
    .map((d) => d.name)
    .sort()
}

const templates = discoverTemplates()

function dockerExec(cmd: string, timeout = 30_000) {
  return execSync(cmd, { stdio: 'pipe', timeout }).toString()
}

describe('docker template tests', () => {
  before(async () => {
    // Clean up any leftovers from previous runs, then create fresh
    try {
      dockerExec(`docker rm -f ${PG_CONTAINER}`)
    } catch {}
    try {
      dockerExec(`docker network rm ${NETWORK}`)
    } catch {}
    dockerExec(`docker network create ${NETWORK}`)
    dockerExec(
      `docker run -d --name ${PG_CONTAINER} --network ${NETWORK} -p ${PG_PORT}:5432 -e POSTGRES_PASSWORD=postgres postgres:17-alpine`,
    )

    // Wait for postgres to accept connections via the host port mapping
    let sql!: postgres.Sql
    for (let i = 0; i < 30; i++) {
      try {
        sql = postgres({
          host: '127.0.0.1',
          port: PG_PORT,
          database: 'postgres',
          user: 'postgres',
          password: 'postgres',
          connect_timeout: 5,
        })
        await sql`SELECT 1`
        break
      } catch {
        try {
          await sql.end()
        } catch {}
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
    const schemaSql = readFileSync(join(TEST_DIR, 'fixture.sql'), 'utf-8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('-- @import'))
      .join('\n')
    await sql.unsafe(schemaSql)
    await sql.unsafe(readFileSync(join(TEST_DIR, 'fixture-seed.sql'), 'utf-8'))
    await sql.end()
    console.log('Database seeded.')

    // Run codegen — outputs directly into each src/<template>/test/ directory
    console.log('Running codegen...')
    execSync(
      `${process.execPath} ${join(REPO_ROOT, 'packages/cli/src/main.ts')} codegen -c ${join(TEST_DIR, 'sqldoc.config.ts')} ${join(TEST_DIR, 'fixture.sql')}`,
      {
        cwd: TEMPLATES_DIR,
        stdio: 'pipe',
        timeout: 120_000,
        env: { ...process.env, SQLDOC_RESOLVE_FROM_LOCAL_PACKAGE: 'true' },
      },
    )
    console.log(`Codegen complete. Testing ${templates.length} templates.`)
  })

  after(() => {
    try {
      dockerExec(`docker rm -f ${PG_CONTAINER}`)
    } catch {}
    try {
      dockerExec(`docker network rm ${NETWORK}`)
    } catch {}
  })

  describe('docker templates', () => {
    for (const name of templates) {
      it(name, () => {
        const testDir = join(SRC_DIR, name, 'test')
        const tag = `sqldoc-test-${name}`
        try {
          execSync(`docker build -t ${tag} ${testDir}`, {
            stdio: 'pipe',
            timeout: 120_000,
          })
          execSync(`docker run --rm --network ${NETWORK} -e DATABASE_URL="${DB_URL}" ${tag}`, {
            stdio: 'pipe',
            timeout: 30_000,
          })
        } catch (err: any) {
          const stderr = err.stderr?.toString() ?? ''
          const stdout = err.stdout?.toString() ?? ''
          throw new Error(`Docker test failed for ${name}:\n${stderr}\n${stdout}`)
        } finally {
          try {
            execSync(`docker rmi ${tag}`, { stdio: 'ignore' })
          } catch {}
        }
      })
    }
  })
})
