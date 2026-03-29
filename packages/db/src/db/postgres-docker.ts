import * as path from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { GenericContainer, Wait } from 'testcontainers'
import { createPostgresAdapter } from './postgres.ts'
import type { DatabaseAdapter } from './types.ts'

/**
 * Create a Docker-based DatabaseAdapter using testcontainers.
 * Spins up an ephemeral Postgres container, connects via pg, and
 * automatically cleans up on close() (testcontainers + Ryuk handle
 * orphan cleanup even on process crash).
 *
 * Supports:
 *   docker://postgres:16        — official or custom image
 *   dockerfile://path/to/file   — build from Dockerfile
 */
export async function createPostgresDockerAdapter(devUrl: string): Promise<DatabaseAdapter> {
  if (devUrl.startsWith('dockerfile://')) {
    return createFromDockerfile(devUrl.slice('dockerfile://'.length))
  }

  // docker://image:tag
  const imageName = devUrl.slice('docker://'.length)
  const container = await new PostgreSqlContainer(imageName)
    .withDatabase('sqldoc_dev')
    .withUsername('sqldoc')
    .withPassword('sqldoc')
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start()

  const pgAdapter = await createPostgresAdapter(container.getConnectionUri())

  return {
    query: pgAdapter.query,
    exec: pgAdapter.exec,
    async close() {
      await pgAdapter.close()
      await container.stop()
    },
  }
}

async function createFromDockerfile(dockerfilePath: string): Promise<DatabaseAdapter> {
  const absPath = path.resolve(dockerfilePath)
  const dir = path.dirname(absPath)
  const file = path.basename(absPath)

  const image = await GenericContainer.fromDockerfile(dir, file).build()

  const container = await image
    .withEnvironment({
      POSTGRES_DB: 'sqldoc_dev',
      POSTGRES_USER: 'sqldoc',
      POSTGRES_PASSWORD: 'sqldoc',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .withStartupTimeout(30_000)
    .start()

  // Wait for postgres to accept connections
  const host = container.getHost()
  const port = container.getMappedPort(5432)
  const connectionUri = `postgres://sqldoc:sqldoc@${host}:${port}/sqldoc_dev`

  // Retry connection — container may need a moment after port is mapped
  let pgAdapter: DatabaseAdapter | undefined
  for (let i = 0; i < 10; i++) {
    try {
      pgAdapter = await createPostgresAdapter(connectionUri)
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  if (!pgAdapter) {
    await container.stop()
    throw new Error(`Failed to connect to Docker Postgres at ${connectionUri}`)
  }

  return {
    query: pgAdapter.query,
    exec: pgAdapter.exec,
    async close() {
      await pgAdapter.close()
      await container.stop()
    },
  }
}
