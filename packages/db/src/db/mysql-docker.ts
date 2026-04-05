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
  const dockerfileImage = devUrl.slice('dockerfile://'.length)
  const containerImage = devUrl.slice('docker://'.length)
  const containerOpts = {
    env: { MYSQL_ROOT_PASSWORD: 'sqldoc', MYSQL_DATABASE: 'sqldoc_dev' },
    port: 3306,
    readyLog,
  }

  function startNewContainer() {
    return isDockerfile
      ? startContainerFromDockerfile({ dockerfilePath: dockerfileImage, ...containerOpts })
      : startContainer({ image: containerImage, ...containerOpts })
  }

  async function connectToContainer(cont: ReturnType<typeof startContainer>): Promise<DatabaseAdapter> {
    const connectionUri = `mysql://root:sqldoc@${cont.host}:${cont.port}/sqldoc_dev`
    for (let i = 0; i < 10; i++) {
      try {
        return await resolveAdapterPlugin({
          devUrl: connectionUri,
          context: { dialect: 'mysql', extensions: [] },
          ...pluginOpts,
        })
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    cont.stop()
    throw new Error(`Failed to connect to Docker MySQL at ${connectionUri}`)
  }

  let container = startNewContainer()
  let inner = await connectToContainer(container)

  return {
    query: (...args) => inner.query(...args),
    exec: (...args) => inner.exec(...args),
    async close() {
      await inner.close()
      container.stop()
    },
    async reset() {
      await inner.close()
      container.stop()
      container = startNewContainer()
      inner = await connectToContainer(container)
    },
  }
}
