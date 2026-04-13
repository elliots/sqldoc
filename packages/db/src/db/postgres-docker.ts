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

  const container = isDockerfile
    ? startContainerFromDockerfile({
        dockerfilePath: devUrl.slice('dockerfile://'.length),
        env: { POSTGRES_DB: 'sqldoc_dev', POSTGRES_USER: 'sqldoc', POSTGRES_PASSWORD: 'sqldoc' },
        port: 5432,
        readyLog,
      })
    : startContainer({
        image: devUrl.slice('docker://'.length),
        env: { POSTGRES_DB: 'sqldoc_dev', POSTGRES_USER: 'sqldoc', POSTGRES_PASSWORD: 'sqldoc' },
        port: 5432,
        readyLog,
      })

  const connectionUri = `postgres://sqldoc:sqldoc@${container.host}:${container.port}/sqldoc_dev`

  // Retry connection — container may need a moment after port is mapped
  let pgAdapter: DatabaseAdapter | undefined
  for (let i = 0; i < 10; i++) {
    try {
      pgAdapter = await resolveAdapterPlugin({
        devUrl: connectionUri,
        context: { dialect: 'postgres', extensions: [] },
        ...pluginOpts,
      })
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  if (!pgAdapter) {
    container.stop()
    throw new Error(`Failed to connect to Docker Postgres at ${connectionUri}`)
  }

  return {
    currentSchema: pgAdapter.currentSchema,
    query: pgAdapter.query,
    exec: pgAdapter.exec,
    async close() {
      try {
        await pgAdapter.close()
      } finally {
        container.stop()
      }
    },
  }
}
