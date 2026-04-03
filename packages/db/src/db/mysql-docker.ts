import { startContainer } from './docker.ts'
import { createMysqlAdapter } from './mysql.ts'
import type { DatabaseAdapter } from './types.ts'

/**
 * Create a Docker-based MySQL DatabaseAdapter.
 * Supports: docker://mysql:8, docker://mysql:8.0, docker://mariadb:10, etc.
 */
export async function createMysqlDockerAdapter(devUrl: string): Promise<DatabaseAdapter> {
  const imageName = devUrl.slice('docker://'.length)

  const container = startContainer({
    image: imageName,
    env: { MYSQL_ROOT_PASSWORD: 'sqldoc', MYSQL_DATABASE: 'sqldoc_dev' },
    port: 3306,
    readyLog: /ready for connections.*port: 3306/,
  })

  const connectionUri = `mysql://root:sqldoc@${container.host}:${container.port}/sqldoc_dev`

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
    container.stop()
    throw new Error(`Failed to connect to Docker MySQL at ${connectionUri}`)
  }

  return {
    query: mysqlAdapter.query,
    exec: mysqlAdapter.exec,
    async close() {
      await mysqlAdapter.close()
      container.stop()
    },
  }
}
