/**
 * Docker-based MSSQL DatabaseAdapter with shared container reuse.
 *
 * Uses a named container (`sqldoc-mssql-dev`) so multiple processes share the same
 * MSSQL instance. On each use:
 *
 * 1. Try to start a named container — if it already exists, connect to the existing one
 * 2. Connect and acquire a database-level application lock (`sp_getapplock`)
 * 3. Wipe the dev database (clean slate for each caller)
 * 4. Release the lock on close
 *
 * This avoids the slow startup cost of MSSQL Docker on every invocation.
 */

import { execSync, spawnSync } from 'node:child_process'
import type { ResolvePluginOptions } from './plugin-resolver.ts'
import { resolveAdapterPlugin } from './plugin-resolver.ts'
import type { DatabaseAdapter, DatabaseAdapterPlugin } from './types.ts'

/** MSSQL SA password — must meet complexity requirements. */
const SA_PASSWORD = 'Sqldoc_Dev1!'
const CONTAINER_NAME = 'sqldoc-mssql-dev'
const LOCK_RESOURCE = 'sqldoc_dev_lock'
const DEFAULT_IMAGE = 'mcr.microsoft.com/mssql/server:2022-latest'

const log = process.env.DEBUG ? (msg: string) => console.error(`[mssql-docker] ${msg}`) : () => {}

export interface MssqlDockerOptions extends Pick<ResolvePluginOptions, 'sqldocDir' | 'onMissingPlugin'> {
  /** Provide the MSSQL adapter plugin directly, bypassing plugin resolution. */
  adapterPlugin?: DatabaseAdapterPlugin
}

/** Connect using either the provided plugin or the plugin resolver. */
async function connect(devUrl: string, opts?: MssqlDockerOptions): Promise<DatabaseAdapter> {
  if (opts?.adapterPlugin) {
    return opts.adapterPlugin.createAdapter(devUrl, { dialect: 'mssql', extensions: [] })
  }
  return resolveAdapterPlugin({
    devUrl,
    context: { dialect: 'mssql', extensions: [] },
    sqldocDir: opts?.sqldocDir,
    onMissingPlugin: opts?.onMissingPlugin,
  })
}

/** Get the mapped host port for the named container, or null if not running. */
function getContainerPort(): number | null {
  try {
    const output = execSync(`docker port ${CONTAINER_NAME} 1433 2>/dev/null`, { encoding: 'utf-8' }).trim()
    const match = output.match(/:(\d+)$/)
    return match ? parseInt(match[1], 10) : null
  } catch {
    return null
  }
}

/** Ensure the named MSSQL container is running. Returns the mapped port. */
async function ensureContainer(image: string): Promise<number> {
  // Check if already running
  const existingPort = getContainerPort()
  if (existingPort) {
    log(`reusing existing container ${CONTAINER_NAME} on port ${existingPort}`)
    return existingPort
  }

  // Try to start — if name is taken but stopped, remove it first
  try {
    spawnSync('docker', ['rm', '-f', CONTAINER_NAME], { stdio: 'pipe' })
  } catch {
    // Container didn't exist — fine
  }

  log(`starting container ${CONTAINER_NAME} from ${image}...`)
  const result = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      CONTAINER_NAME,
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
    const retryPort = getContainerPort()
    if (retryPort) {
      log(`container started by another process, port ${retryPort}`)
      return retryPort
    }
    throw new Error(`Failed to start MSSQL container: ${result.stderr}`)
  }

  // Wait for SQL Server to be ready
  log('waiting for SQL Server to be ready...')
  const start = Date.now()
  const timeout = 90_000
  while (Date.now() - start < timeout) {
    try {
      const logs = execSync(`docker logs ${CONTAINER_NAME} 2>&1`, { encoding: 'utf-8' })
      if (/SQL Server is now ready for client connections/.test(logs)) {
        const port = getContainerPort()
        if (port) {
          log(`ready on port ${port} (${Math.round((Date.now() - start) / 1000)}s)`)
          return port
        }
      }
    } catch {
      // Container might not be ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`MSSQL container did not become ready within ${timeout / 1000}s`)
}

/** Wipe all user objects from the sqldoc_dev database. */
async function wipeDevDatabase(db: DatabaseAdapter): Promise<void> {
  log('wiping dev database...')
  // Drop in dependency order: FKs → tables → views → procs → funcs → sequences
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

export async function createMssqlDockerAdapter(
  devUrl: string,
  pluginOpts?: MssqlDockerOptions,
): Promise<DatabaseAdapter> {
  const image = devUrl.startsWith('docker://') ? devUrl.slice('docker://'.length) : DEFAULT_IMAGE
  const port = await ensureContainer(image)

  // Connect to master and ensure dev database exists
  const masterUri = `mssql://sa:${SA_PASSWORD}@127.0.0.1:${port}/master`
  let masterDb: DatabaseAdapter | undefined
  for (let i = 0; i < 10; i++) {
    try {
      masterDb = await connect(masterUri, pluginOpts)
      break
    } catch (err: any) {
      log(`connect attempt ${i + 1}: ${err?.message}`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  if (!masterDb) throw new Error(`Failed to connect to MSSQL at 127.0.0.1:${port}`)

  try {
    await masterDb.exec(`
      IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'sqldoc_dev')
        CREATE DATABASE sqldoc_dev
    `)
  } finally {
    await masterDb.close()
  }

  // Connect to dev database
  const devUri = `mssql://sa:${SA_PASSWORD}@127.0.0.1:${port}/sqldoc_dev`
  const db = await connect(devUri, pluginOpts)

  // Acquire application lock — blocks if another process is using the dev database
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

  return {
    query: db.query,
    exec: db.exec,
    async close() {
      log('releasing lock...')
      try {
        await db.exec(`EXEC sp_releaseapplock @Resource = '${LOCK_RESOURCE}', @LockOwner = 'Session'`)
      } catch {
        // Connection may already be closed — lock releases with session
      }
      await db.close()
      // Don't stop the container — it's shared and reused
      log('closed')
    },
  }
}
