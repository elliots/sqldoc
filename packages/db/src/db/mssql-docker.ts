/**
 * Docker-based MSSQL DatabaseAdapter with optional shared container reuse.
 *
 * When `reuseContainer: true`, uses a named container (`sqldoc_mcr.microsoft.com.mssql.server.2022-latest`)
 * so multiple processes share the same MSSQL instance with sp_getapplock locking and wiping.
 *
 * When `reuseContainer: false` (default), starts a unique container per caller
 * and removes it on close. A process.on('exit') handler ensures cleanup on crash.
 */

import { execSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import * as net from 'node:net'
import type { ResolvePluginOptions } from './plugin-resolver.ts'
import { resolveAdapterPlugin } from './plugin-resolver.ts'
import type { DatabaseAdapter } from './types.ts'

/** Sanitize an image name into a valid container name. */
function sanitize(image: string): string {
  return image.replace(/[^a-zA-Z0-9._-]/g, '.')
}

/** MSSQL SA password — must meet complexity requirements. */
const SA_PASSWORD = 'Sqldoc_Dev1!'
const LOCK_RESOURCE = 'sqldoc_dev_lock'
const DEFAULT_IMAGE = 'mcr.microsoft.com/mssql/server:2022-latest'

const log = process.env.DEBUG ? (msg: string) => console.error(`[mssql-docker] ${msg}`) : () => {}

export interface MssqlDockerOptions extends Pick<ResolvePluginOptions, 'sqldocDir' | 'onMissingPlugin'> {
  /** Provide the MSSQL adapter plugin directly, bypassing plugin resolution. */
  adapterPlugin?: ResolvePluginOptions['adapterPlugin']
  /** When true, reuse a shared named container with locking. When false (default), start a unique container per caller. */
  reuseContainer?: boolean
}

/** Connect using the plugin resolver, optionally forcing a provided plugin. */
async function connect(devUrl: string, opts?: MssqlDockerOptions): Promise<DatabaseAdapter> {
  return resolveAdapterPlugin({
    devUrl,
    context: { dialect: 'mssql', extensions: [] },
    adapterPlugin: opts?.adapterPlugin,
    sqldocDir: opts?.sqldocDir,
    onMissingPlugin: opts?.onMissingPlugin,
  })
}

/** Get the mapped host port for the named container, or null if not running. */
function getContainerPort(name: string): number | null {
  try {
    const output = execSync(`docker port ${name} 1433 2>/dev/null`, { encoding: 'utf-8' }).trim()
    const match = output.match(/:(\d+)$/)
    return match ? parseInt(match[1], 10) : null
  } catch {
    return null
  }
}

/** Start a new MSSQL container. Returns the container name and mapped port. */
async function startContainer(image: string, name: string): Promise<{ name: string; port: number }> {
  // Remove any stopped container with the same name
  try {
    spawnSync('docker', ['rm', '-f', name], { stdio: 'pipe' })
  } catch {}

  log(`starting container ${name} from ${image}...`)
  const result = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      name,
      '-e',
      `ACCEPT_EULA=Y`,
      '-e',
      `MSSQL_SA_PASSWORD=${SA_PASSWORD}`,
      '-p',
      '0:1433',
      image,
    ],
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  )

  if (result.status !== 0) {
    // Another process may have started it between our check and our run
    const retryPort = getContainerPort(name)
    if (retryPort) {
      log(`container started by another process, port ${retryPort}`)
      return { name, port: retryPort }
    }
    throw new Error(`Failed to start MSSQL container: ${result.stderr}`)
  }

  // Wait for SQL Server to be ready
  log('waiting for SQL Server to be ready...')
  const start = Date.now()
  const timeout = 90_000
  while (Date.now() - start < timeout) {
    try {
      const logs = execSync(`docker logs ${name} 2>&1`, { encoding: 'utf-8' })
      if (/SQL Server is now ready for client connections/.test(logs)) {
        const port = getContainerPort(name)
        if (port) {
          // Verify TCP is actually accepting connections
          const ok = await new Promise<boolean>((resolve) => {
            const sock = net.connect(port, '127.0.0.1', () => {
              sock.destroy()
              resolve(true)
            })
            sock.on('error', () => resolve(false))
            sock.setTimeout(1000, () => {
              sock.destroy()
              resolve(false)
            })
          })
          if (ok) {
            log(`ready on port ${port} (${Math.round((Date.now() - start) / 1000)}s)`)
            return { name, port }
          }
        }
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`MSSQL container did not become ready within ${timeout / 1000}s`)
}

/** Wipe all user objects from the sqldoc_dev database. */
async function wipeDevDatabase(db: DatabaseAdapter): Promise<void> {
  log('wiping dev database...')
  const dropScripts = [
    `DECLARE @sql NVARCHAR(MAX) = ''
     SELECT @sql += 'ALTER TABLE [' + s.name + '].[' + t.name + '] DROP CONSTRAINT [' + fk.name + '];'
     FROM sys.foreign_keys fk
     JOIN sys.tables t ON fk.parent_object_id = t.object_id
     JOIN sys.schemas s ON t.schema_id = s.schema_id
     WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
     EXEC(@sql)`,
    `DECLARE @sql NVARCHAR(MAX) = ''
     SELECT @sql += 'DROP TABLE [' + s.name + '].[' + t.name + '];'
     FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
     WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
     EXEC(@sql)`,
    `DECLARE @sql NVARCHAR(MAX) = ''
     SELECT @sql += 'DROP VIEW [' + s.name + '].[' + v.name + '];'
     FROM sys.views v JOIN sys.schemas s ON v.schema_id = s.schema_id
     WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
     EXEC(@sql)`,
    `DECLARE @sql NVARCHAR(MAX) = ''
     SELECT @sql += 'DROP PROCEDURE [' + s.name + '].[' + o.name + '];'
     FROM sys.objects o JOIN sys.schemas s ON o.schema_id = s.schema_id
     WHERE o.type = 'P' AND s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
     EXEC(@sql)`,
    `DECLARE @sql NVARCHAR(MAX) = ''
     SELECT @sql += 'DROP FUNCTION [' + s.name + '].[' + o.name + '];'
     FROM sys.objects o JOIN sys.schemas s ON o.schema_id = s.schema_id
     WHERE o.type IN ('FN', 'IF', 'TF') AND s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
     EXEC(@sql)`,
    `DECLARE @sql NVARCHAR(MAX) = ''
     SELECT @sql += 'DROP SEQUENCE [' + s.name + '].[' + seq.name + '];'
     FROM sys.sequences seq JOIN sys.schemas s ON seq.schema_id = s.schema_id
     WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
     EXEC(@sql)`,
  ]
  for (const script of dropScripts) {
    await db.exec(script)
  }
  log('dev database wiped')
}

/** Remove a container, ignoring errors. */
function removeContainer(name: string): void {
  try {
    spawnSync('docker', ['rm', '-f', name], { stdio: 'pipe' })
  } catch {}
}

export async function createMssqlDockerAdapter(
  devUrl: string,
  pluginOpts?: MssqlDockerOptions,
): Promise<DatabaseAdapter> {
  const image = devUrl.startsWith('docker://') ? devUrl.slice('docker://'.length) : DEFAULT_IMAGE

  const reuse = pluginOpts?.reuseContainer ?? false
  const baseName = `sqldoc_${sanitize(image)}`
  let container: { name: string; port: number }

  if (reuse) {
    const existingPort = getContainerPort(baseName)
    if (existingPort) {
      log(`reusing existing container ${baseName} on port ${existingPort}`)
      container = { name: baseName, port: existingPort }
    } else {
      container = await startContainer(image, baseName)
    }
  } else {
    const uniqueName = `${baseName}-${randomBytes(4).toString('hex')}`
    container = await startContainer(image, uniqueName)
  }

  // Safety net: remove non-reuse containers on process exit
  const exitHandler = !reuse ? () => removeContainer(container.name) : undefined
  if (exitHandler) process.on('exit', exitHandler)

  // Connect to master and ensure dev database exists
  const masterUri = `mssql://sa:${SA_PASSWORD}@127.0.0.1:${container.port}/master?acceptUntrustedServerCertificate=true`
  let masterDb: DatabaseAdapter | undefined
  for (let i = 0; i < 10; i++) {
    try {
      masterDb = await connect(masterUri, pluginOpts)
      break
    } catch (err: any) {
      log(`master connect attempt ${i + 1}: ${err?.message}`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  if (!masterDb) {
    if (!reuse) removeContainer(container.name)
    throw new Error(`Failed to connect to MSSQL at 127.0.0.1:${container.port}`)
  }

  try {
    await masterDb.exec(`
      IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'sqldoc_dev')
        CREATE DATABASE sqldoc_dev
    `)
  } finally {
    await masterDb.close()
  }

  // Connect to dev database
  const devUri = `mssql://sa:${SA_PASSWORD}@127.0.0.1:${container.port}/sqldoc_dev?acceptUntrustedServerCertificate=true`
  const db = await connect(devUri, pluginOpts)

  if (reuse) {
    // Acquire application lock + wipe for shared container
    try {
      log('acquiring lock...')
      await db.exec(`
        DECLARE @result INT
        EXEC @result = sp_getapplock @Resource = '${LOCK_RESOURCE}', @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 60000
        IF @result < 0 RAISERROR('Failed to acquire lock (result=%d)', 16, 1, @result)
      `)
      log('lock acquired')
      await wipeDevDatabase(db)
    } catch (err) {
      await db.close()
      throw err
    }
  }

  return {
    currentSchema: db.currentSchema,
    query: db.query,
    exec: db.exec,
    async close() {
      if (reuse) {
        log('releasing lock...')
        try {
          await db.exec(`EXEC sp_releaseapplock @Resource = '${LOCK_RESOURCE}', @LockOwner = 'Session'`)
        } catch {}
      }
      await db.close()
      if (!reuse) {
        log(`removing container ${container.name}...`)
        removeContainer(container.name)
        if (exitHandler) process.removeListener('exit', exitHandler)
      }
      log('closed')
    },
  }
}
