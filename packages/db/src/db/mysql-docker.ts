import { startContainer, startContainerFromDockerfile } from './docker.ts'
import type { ResolvePluginOptions } from './plugin-resolver.ts'
import { resolveAdapterPlugin } from './plugin-resolver.ts'
import type { DatabaseAdapter } from './types.ts'

/**
 * Create a Docker-based MySQL DatabaseAdapter.
 *
 * Supports:
 *   docker://mysql:8           — official or custom image
 *   docker://mariadb:10        — MariaDB
 *   dockerfile://path/to/file  — build from Dockerfile
 */
export async function createMysqlDockerAdapter(
  devUrl: string,
  pluginOpts?: Pick<ResolvePluginOptions, 'sqldocDir' | 'onMissingPlugin'>,
): Promise<DatabaseAdapter> {
  const isDockerfile = devUrl.startsWith('dockerfile://')
  const readyLog = /ready for connections.*port: 3306/

  const container = isDockerfile
    ? startContainerFromDockerfile({
        dockerfilePath: devUrl.slice('dockerfile://'.length),
        env: { MYSQL_ROOT_PASSWORD: 'sqldoc', MYSQL_DATABASE: 'sqldoc_dev' },
        port: 3306,
        readyLog,
      })
    : startContainer({
        image: devUrl.slice('docker://'.length),
        env: { MYSQL_ROOT_PASSWORD: 'sqldoc', MYSQL_DATABASE: 'sqldoc_dev' },
        port: 3306,
        readyLog,
      })

  const connectionUri = `mysql://root:sqldoc@${container.host}:${container.port}/sqldoc_dev`

  // Retry connection — container may need a moment after port is mapped
  let mysqlAdapter: DatabaseAdapter | undefined
  for (let i = 0; i < 10; i++) {
    try {
      mysqlAdapter = await resolveAdapterPlugin({
        devUrl: connectionUri,
        context: { dialect: 'mysql', extensions: [] },
        ...pluginOpts,
      })
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  if (!mysqlAdapter) {
    container.stop()
    throw new Error(`Failed to connect to Docker MySQL at ${connectionUri}`)
  }

  return {
    currentSchema: mysqlAdapter.currentSchema,
    query: mysqlAdapter.query,
    exec: mysqlAdapter.exec,
    async close() {
      try {
        await mysqlAdapter.close()
      } finally {
        container.stop()
      }
    },
  }
}
