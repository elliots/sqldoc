/**
 * MySQL Docker adapter using testcontainers GenericContainer.
 * Uses log-based wait strategy (same as Postgres adapter) for Bun compatibility —
 * MySqlContainer's built-in health check hangs in Bun's runtime.
 */
import { GenericContainer, Wait } from 'testcontainers'
import { createMysqlAdapter } from './mysql.ts'
import type { DatabaseAdapter } from './types.ts'

/**
 * Create a Docker-based MySQL DatabaseAdapter using testcontainers.
 * Supports: docker://mysql:8, docker://mysql:8.0, docker://mariadb:10, etc.
 */
export async function createMysqlDockerAdapter(devUrl: string): Promise<DatabaseAdapter> {
  const imageName = devUrl.slice('docker://'.length)

  const container = await new GenericContainer(imageName)
    .withEnvironment({
      MYSQL_ROOT_PASSWORD: 'sqldoc',
      MYSQL_DATABASE: 'sqldoc_dev',
    })
    .withExposedPorts(3306)
    .withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306/, 2))
    .start()

  const host = container.getHost()
  const port = container.getMappedPort(3306)
  const connectionUri = `mysql://root:sqldoc@${host}:${port}/sqldoc_dev`

  // Retry connection — container may need a moment after port is mapped
  let mysqlAdapter: DatabaseAdapter | undefined
  for (let i = 0; i < 10; i++) {
    try {
      mysqlAdapter = await createMysqlAdapter(connectionUri)
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  if (!mysqlAdapter) {
    await container.stop()
    throw new Error(`Failed to connect to Docker MySQL at ${connectionUri}`)
  }

  return {
    query: mysqlAdapter.query,
    exec: mysqlAdapter.exec,
    async close() {
      await mysqlAdapter.close()
      await container.stop()
    },
  }
}
