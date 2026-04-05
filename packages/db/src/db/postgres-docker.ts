import { startContainer, startContainerFromDockerfile } from './docker.ts'
import type { ResolvePluginOptions } from './plugin-resolver.ts'
import { resolveAdapterPlugin } from './plugin-resolver.ts'
import type { DatabaseAdapter } from './types.ts'

/**
 * Create a Docker-based DatabaseAdapter for Postgres.
 * Spins up an ephemeral container, connects via the plugin system, cleans up on close().
 *
 * Supports:
 *   docker://postgres:16        — official or custom image
 *   dockerfile://path/to/file   — build from Dockerfile
 */
export async function createPostgresDockerAdapter(
  devUrl: string,
  pluginOpts?: Pick<ResolvePluginOptions, 'sqldocDir' | 'onMissingPlugin'>,
): Promise<DatabaseAdapter> {
  const isDockerfile = devUrl.startsWith('dockerfile://')
  const readyLog = 'database system is ready to accept connections'
  const dockerfileImage = devUrl.slice('dockerfile://'.length)
  const containerImage = devUrl.slice('docker://'.length)
  const containerOpts = {
    env: { POSTGRES_DB: 'sqldoc_dev', POSTGRES_USER: 'sqldoc', POSTGRES_PASSWORD: 'sqldoc' },
    port: 5432,
    readyLog,
  }

  function startNewContainer() {
    return isDockerfile
      ? startContainerFromDockerfile({ dockerfilePath: dockerfileImage, ...containerOpts })
      : startContainer({ image: containerImage, ...containerOpts })
  }

  async function connectToContainer(cont: ReturnType<typeof startContainer>): Promise<DatabaseAdapter> {
    const connectionUri = `postgres://sqldoc:sqldoc@${cont.host}:${cont.port}/sqldoc_dev`
    for (let i = 0; i < 10; i++) {
      try {
        return await resolveAdapterPlugin({
          devUrl: connectionUri,
          context: { dialect: 'postgres', extensions: [] },
          ...pluginOpts,
        })
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    cont.stop()
    throw new Error(`Failed to connect to Docker Postgres at ${connectionUri}`)
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
