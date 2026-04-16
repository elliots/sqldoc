/**
 * Container DbSource: starts a Docker container, then creates shadow databases
 * inside it for each open(). Replaces the old per-dialect docker adapters.
 */

import { execSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import * as net from 'node:net'
import type { DatabaseAdapter, DbSource } from '@sqldoc/inspector'
import { cleanupStaleContainers, startContainerFromDockerfile } from './docker.ts'
import type { ResolvePluginOptions } from './plugin-resolver.ts'
import { resolveAdapterPlugin } from './plugin-resolver.ts'
import type { ShadowSqlDialect } from './shadow-sql.ts'
import { cleanupStaleShadows, getShadowSqlDialect, newShadowDatabaseName } from './shadow-sql.ts'
import type { AdapterPluginContext, DatabaseAdapterPlugin, Dialect } from './types.ts'

const LABEL = 'sqldoc-dev'
const log = process.env.DEBUG ? (msg: string) => console.error(`[dbsource-container] ${msg}`) : () => {}

export interface ContainerDbSourceOptions {
  devUrl: string
  context: AdapterPluginContext
  adapterPlugin?: DatabaseAdapterPlugin
  sqldocDir?: ResolvePluginOptions['sqldocDir']
  onMissingPlugin?: ResolvePluginOptions['onMissingPlugin']
  reuseContainer?: boolean
}

interface DialectContainerSpec {
  defaultImage: string
  internalPort: number
  env: Record<string, string>
  readyLog: string | RegExp
  readyTimeoutMs: number
  adminUrl(host: string, port: number, sql: ShadowSqlDialect): string
  connectRetries: number
  defaultReuse: boolean
}

const MSSQL_SA_PASSWORD = 'Sqldoc_Dev1!'

const SPECS: Record<Dialect, DialectContainerSpec | undefined> = {
  postgres: {
    defaultImage: 'postgres:16',
    internalPort: 5432,
    env: { POSTGRES_DB: 'postgres', POSTGRES_USER: 'sqldoc', POSTGRES_PASSWORD: 'sqldoc' },
    readyLog: 'database system is ready to accept connections',
    readyTimeoutMs: 30_000,
    adminUrl: (host, port, sql) => `postgres://sqldoc:sqldoc@${host}:${port}/${sql.maintenanceDb}`,
    connectRetries: 10,
    defaultReuse: true,
  },
  mysql: {
    defaultImage: 'mysql:8',
    internalPort: 3306,
    env: { MYSQL_ROOT_PASSWORD: 'sqldoc' },
    readyLog: /ready for connections.*port: 3306/,
    readyTimeoutMs: 60_000,
    adminUrl: (host, port, sql) => `mysql://root:sqldoc@${host}:${port}/${sql.maintenanceDb}`,
    connectRetries: 20,
    defaultReuse: true,
  },
  mssql: {
    defaultImage: 'mcr.microsoft.com/mssql/server:2022-latest',
    internalPort: 1433,
    env: { ACCEPT_EULA: 'Y', MSSQL_SA_PASSWORD },
    readyLog: 'SQL Server is now ready for client connections',
    readyTimeoutMs: 120_000,
    adminUrl: (host, port, sql) =>
      `mssql://sa:${MSSQL_SA_PASSWORD}@${host}:${port}/${sql.maintenanceDb}?acceptUntrustedServerCertificate=true`,
    connectRetries: 20,
    defaultReuse: true,
  },
  sqlite: undefined,
}

function sanitizeName(image: string): string {
  return image.replace(/[^a-zA-Z0-9._-]/g, '.')
}

function removeContainer(name: string): void {
  try {
    spawnSync('docker', ['rm', '-f', name], { stdio: 'pipe' })
  } catch {}
}

function getMappedPort(name: string, internalPort: number): number | null {
  try {
    const output = execSync(`docker port ${name} ${internalPort} 2>/dev/null`, { encoding: 'utf-8' }).trim()
    const match = output.match(/:(\d+)$/)
    return match ? Number.parseInt(match[1], 10) : null
  } catch {
    return null
  }
}

async function waitForReadyLog(name: string, pattern: string | RegExp, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const logs = execSync(`docker logs ${name} 2>&1`, { encoding: 'utf-8' })
      if (typeof pattern === 'string' ? logs.includes(pattern) : pattern.test(logs)) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Container ${name} did not become ready within ${timeoutMs}ms`)
}

async function waitForTcp(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.destroy()
        resolve(true)
      })
      sock.on('error', () => resolve(false))
      sock.setTimeout(500, () => {
        sock.destroy()
        resolve(false)
      })
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

interface StartedContainer {
  name: string
  host: string
  port: number
  reused: boolean
  cleanup: (() => void) | null
}

function startOrReuse(image: string, spec: DialectContainerSpec, reuse: boolean): StartedContainer {
  const baseName = `sqldoc_${sanitizeName(image)}`
  if (reuse) {
    const existing = getMappedPort(baseName, spec.internalPort)
    if (existing != null) {
      log(`reusing container ${baseName} on port ${existing}`)
      return { name: baseName, host: '127.0.0.1', port: existing, reused: true, cleanup: null }
    }
  }

  const name = reuse ? baseName : `${baseName}-${randomBytes(4).toString('hex')}`
  cleanupStaleContainers()
  spawnSync('docker', ['rm', '-f', name], { stdio: 'pipe' })

  const envArgs = Object.entries(spec.env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const lifecycleArgs = reuse ? [] : ['--rm']
  const result = spawnSync(
    'docker',
    [
      'run',
      '-d',
      ...lifecycleArgs,
      '--name',
      name,
      '--label',
      LABEL,
      '-p',
      `0:${spec.internalPort}`,
      ...envArgs,
      image,
    ],
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  )

  if (result.status !== 0) {
    if (reuse) {
      const retryPort = getMappedPort(name, spec.internalPort)
      if (retryPort != null) return { name, host: '127.0.0.1', port: retryPort, reused: true, cleanup: null }
    }
    throw new Error(`Failed to start Docker container: ${result.stderr}`)
  }

  const port = getMappedPort(name, spec.internalPort)
  if (port == null) {
    removeContainer(name)
    throw new Error(`Failed to get mapped port for container ${name}`)
  }

  return { name, host: '127.0.0.1', port, reused: false, cleanup: reuse ? null : () => removeContainer(name) }
}

export async function createContainerDbSource(opts: ContainerDbSourceOptions): Promise<DbSource> {
  const { dialect } = opts.context
  const spec = SPECS[dialect]
  if (!spec) throw new Error(`Container-based dev databases are not supported for dialect '${dialect}'`)

  const sql = getShadowSqlDialect(dialect)
  const reuse = opts.reuseContainer ?? spec.defaultReuse
  const isDockerfile = opts.devUrl.startsWith('dockerfile://')

  let container: StartedContainer
  if (isDockerfile) {
    const dc = startContainerFromDockerfile({
      dockerfilePath: opts.devUrl.slice('dockerfile://'.length),
      env: spec.env,
      port: spec.internalPort,
      readyLog: spec.readyLog,
    })
    container = { name: dc.id, host: dc.host, port: dc.port, reused: false, cleanup: () => dc.stop() }
  } else {
    const image = opts.devUrl.startsWith('docker://') ? opts.devUrl.slice('docker://'.length) : spec.defaultImage
    container = startOrReuse(image, spec, reuse)
  }

  const exitCleanup = container.cleanup
  if (exitCleanup) process.on('exit', exitCleanup)

  try {
    if (!container.reused) await waitForReadyLog(container.name, spec.readyLog, spec.readyTimeoutMs)
    if (!(await waitForTcp(container.port, 10_000))) {
      throw new Error(`Container ${container.name} port ${container.port} not accepting connections`)
    }

    const adminUrl = spec.adminUrl(container.host, container.port, sql)
    const admin = await connectWithRetries(adminUrl, opts, spec.connectRetries)

    await cleanupStaleShadows(admin, sql)

    const outstanding = new Set<string>()
    let adminQueue: Promise<unknown> = Promise.resolve()
    const runAdmin = <T>(fn: () => Promise<T>): Promise<T> => {
      const next = adminQueue.then(fn, fn)
      adminQueue = next.catch(() => {})
      return next
    }
    let closed = false

    const dropSilently = async (name: string) => {
      for (const stmt of sql.dropDatabaseSql(name)) {
        try {
          await runAdmin(() => admin.exec(stmt))
        } catch (err) {
          if (process.env.DEBUG) console.error(`[dbsource-container] drop ${name}: ${(err as Error)?.message}`)
        }
      }
    }

    return {
      async open(): Promise<DatabaseAdapter> {
        if (closed) throw new Error('DbSource is closed')
        const name = newShadowDatabaseName()
        try {
          await runAdmin(() => admin.exec(sql.createDatabaseSql(name)))
        } catch (err) {
          throw new Error(
            `Failed to create shadow database '${name}' in container: ${(err as Error)?.message}. Hint: ${sql.permissionHint()}`,
            { cause: err as Error },
          )
        }
        outstanding.add(name)

        const shadowUrl = sql.withDatabase(adminUrl, name)
        let shadowDb: DatabaseAdapter
        try {
          shadowDb = await resolveAdapterPlugin({
            devUrl: shadowUrl,
            context: opts.context,
            adapterPlugin: opts.adapterPlugin,
            sqldocDir: opts.sqldocDir,
            onMissingPlugin: opts.onMissingPlugin,
          })
        } catch (err) {
          await dropSilently(name)
          outstanding.delete(name)
          throw err
        }

        const originalClose = shadowDb.close.bind(shadowDb)
        return {
          currentSchema: shadowDb.currentSchema,
          query: shadowDb.query.bind(shadowDb),
          exec: shadowDb.exec.bind(shadowDb),
          async close() {
            try {
              await originalClose()
            } finally {
              await dropSilently(name)
              outstanding.delete(name)
            }
          },
        }
      },

      async close(): Promise<void> {
        if (closed) return
        closed = true
        for (const name of [...outstanding]) await dropSilently(name)
        outstanding.clear()
        await admin.close()
        if (exitCleanup) {
          process.removeListener('exit', exitCleanup)
          exitCleanup()
        }
      },
    }
  } catch (err) {
    if (exitCleanup) {
      process.removeListener('exit', exitCleanup)
      exitCleanup()
    }
    throw err
  }
}

async function connectWithRetries(
  url: string,
  opts: ContainerDbSourceOptions,
  retries: number,
): Promise<DatabaseAdapter> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      return await resolveAdapterPlugin({
        devUrl: url,
        context: opts.context,
        adapterPlugin: opts.adapterPlugin,
        sqldocDir: opts.sqldocDir,
        onMissingPlugin: opts.onMissingPlugin,
      })
    } catch (err) {
      lastErr = err
      log(`admin connect attempt ${i + 1}: ${(err as Error)?.message}`)
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw new Error(`Failed to connect to container at ${url}: ${(lastErr as Error)?.message}`, {
    cause: lastErr as Error,
  })
}
