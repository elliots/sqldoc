/**
 * MySQL Docker adapter using @testcontainers/mysql.
 * Spins up an ephemeral MySQL container, connects via mysql2, and
 * automatically cleans up on close() (testcontainers + Ryuk handle
 * orphan cleanup even on process crash).
 *
 * Follows the same composition pattern as the Postgres Docker adapter (docker.ts).
 */
import { MySqlContainer } from '@testcontainers/mysql'
import { createMysqlAdapter } from './mysql.ts'
import type { DatabaseAdapter } from './types.ts'

/**
 * Create a Docker-based MySQL DatabaseAdapter using testcontainers.
 * Supports: docker://mysql:8, docker://mysql:8.0, docker://mariadb:10, etc.
 */
export async function createMysqlDockerAdapter(devUrl: string): Promise<DatabaseAdapter> {
  const imageName = devUrl.slice('docker://'.length)

  const container = await new MySqlContainer(imageName)
    .withDatabase('sqldoc_dev')
    .withRootPassword('sqldoc')
    .withExposedPorts(3306)
    .start()

  const connectionUri = `mysql://${container.getUsername()}:${container.getUserPassword()}@${container.getHost()}:${container.getMappedPort(3306)}/${container.getDatabase()}`
  const mysqlAdapter = await createMysqlAdapter(connectionUri)

  return {
    query: mysqlAdapter.query,
    exec: mysqlAdapter.exec,
    async close() {
      await mysqlAdapter.close()
      await container.stop()
    },
  }
}
