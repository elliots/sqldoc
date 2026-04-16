/**
 * Server DbSource: creates shadow databases on an existing SQL server.
 *
 * Takes a server-level connection URL (no database path component). Each
 * open() runs CREATE DATABASE for a unique name, connects, and returns an
 * adapter whose close() runs DROP DATABASE.
 */

import type { DatabaseAdapter, DbSource } from '@sqldoc/inspector'
import type { ResolvePluginOptions } from './plugin-resolver.ts'
import { resolveAdapterPlugin } from './plugin-resolver.ts'
import type { ShadowSqlDialect } from './shadow-sql.ts'
import { cleanupStaleShadows, getShadowSqlDialect, newShadowDatabaseName } from './shadow-sql.ts'
import type { AdapterPluginContext, DatabaseAdapterPlugin } from './types.ts'

export interface ServerDbSourceOptions {
  devUrl: string
  context: AdapterPluginContext
  adapterPlugin?: DatabaseAdapterPlugin
  sqldocDir?: ResolvePluginOptions['sqldocDir']
  onMissingPlugin?: ResolvePluginOptions['onMissingPlugin']
}

export async function createServerDbSource(opts: ServerDbSourceOptions): Promise<DbSource> {
  const sql = getShadowSqlDialect(opts.context.dialect)
  validateServerUrl(opts.devUrl, sql)

  const adminUrl = sql.maintenanceDb ? sql.withDatabase(opts.devUrl, sql.maintenanceDb) : opts.devUrl
  const admin = await connectAdapter(adminUrl, opts)

  await cleanupStaleShadows(admin, sql)

  const outstanding = new Set<string>()
  let adminQueue: Promise<unknown> = Promise.resolve()
  const runAdmin = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = adminQueue.then(fn, fn)
    adminQueue = next.catch(() => {})
    return next
  }
  let closed = false

  return {
    async open(): Promise<DatabaseAdapter> {
      if (closed) throw new Error('DbSource is closed')
      const name = newShadowDatabaseName()

      try {
        await runAdmin(() => admin.exec(sql.createDatabaseSql(name)))
      } catch (err) {
        throw new Error(
          `Failed to create shadow database (${opts.context.dialect}): ${(err as Error)?.message}. Hint: ${sql.permissionHint()}`,
          { cause: err as Error },
        )
      }
      outstanding.add(name)

      let shadowDb: DatabaseAdapter
      try {
        shadowDb = await connectAdapter(sql.withDatabase(opts.devUrl, name), opts)
      } catch (err) {
        await dropSilently(admin, sql, name, runAdmin)
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
            await dropSilently(admin, sql, name, runAdmin)
            outstanding.delete(name)
          }
        },
      }
    },

    async close(): Promise<void> {
      if (closed) return
      closed = true
      for (const name of [...outstanding]) {
        await dropSilently(admin, sql, name, runAdmin)
      }
      outstanding.clear()
      await admin.close()
    },
  }
}

function validateServerUrl(url: string, sql: ShadowSqlDialect): void {
  const db = sql.extractDatabase(url)
  if (db !== undefined) {
    throw new Error(
      `devUrl must point at the server only (no database path), so we never touch a real database. ` +
        `Found database '${db}' in the URL. Remove the trailing '/${db}' and retry.`,
    )
  }
}

function connectAdapter(devUrl: string, opts: ServerDbSourceOptions): Promise<DatabaseAdapter> {
  return resolveAdapterPlugin({
    devUrl,
    context: opts.context,
    adapterPlugin: opts.adapterPlugin,
    sqldocDir: opts.sqldocDir,
    onMissingPlugin: opts.onMissingPlugin,
  })
}

async function dropSilently(
  admin: DatabaseAdapter,
  sql: ShadowSqlDialect,
  name: string,
  runAdmin: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<void> {
  for (const stmt of sql.dropDatabaseSql(name)) {
    try {
      await runAdmin(() => admin.exec(stmt))
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[dbsource-server] failed to drop ${name}: ${(err as Error)?.message}`)
      }
    }
  }
}
