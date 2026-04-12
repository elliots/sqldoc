/**
 * Docker container management for ephemeral dev databases.
 * Uses Docker CLI directly — no testcontainers dependency.
 *
 * Containers are labeled `sqldoc-dev` and auto-removed after 60s via --stop-timeout.
 * On startup, stale containers (>1 min old) are cleaned up.
 */
import { execSync, spawnSync } from 'node:child_process'
import * as path from 'node:path'

const LABEL = 'sqldoc-dev'

/** Clean up any sqldoc-dev containers older than 1 minute */
export function cleanupStaleContainers(): void {
  try {
    const result = execSync(
      `docker ps -aq --filter label=${LABEL} --filter status=running --format "{{.ID}} {{.CreatedAt}}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    for (const line of result.trim().split('\n').filter(Boolean)) {
      const [id, ...dateParts] = line.split(' ')
      const created = new Date(dateParts.join(' '))
      if (Date.now() - created.getTime() > 60_000) {
        spawnSync('docker', ['rm', '-f', id], { stdio: 'pipe' })
      }
    }
  } catch {
    // Docker not available or no containers — fine
  }
}

export interface DockerContainer {
  id: string
  host: string
  port: number
  stop(): void
}

/**
 * Start a Docker container with the given image and port mapping.
 * Returns when the container is running and the port is mapped.
 */
export function startContainer(opts: {
  image: string
  env: Record<string, string>
  port: number
  readyLog: string | RegExp
  readyTimeout?: number
}): DockerContainer {
  cleanupStaleContainers()

  const envArgs = Object.entries(opts.env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const name = `sqldoc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  const result = spawnSync(
    'docker',
    ['run', '-d', '--rm', '--name', name, '--label', LABEL, '-p', `0:${opts.port}`, ...envArgs, opts.image],
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  )

  if (result.status !== 0) {
    throw new Error(`Failed to start Docker container: ${result.stderr}`)
  }

  const id = result.stdout.trim().slice(0, 12)

  // Get mapped port
  const portOutput = execSync(`docker port ${id} ${opts.port}`, { encoding: 'utf-8' }).trim()
  // Format: 0.0.0.0:55432 or [::]:55432
  const portMatch = portOutput.match(/:(\d+)$/)
  if (!portMatch) {
    spawnSync('docker', ['rm', '-f', id], { stdio: 'pipe' })
    throw new Error(`Failed to get mapped port for container ${id}: ${portOutput}`)
  }
  const port = Number.parseInt(portMatch[1], 10)

  // Wait for ready log message
  waitForLog(id, opts.readyLog, opts.readyTimeout ?? 30_000)

  return {
    id,
    host: '127.0.0.1',
    port,
    stop() {
      spawnSync('docker', ['rm', '-f', id], { stdio: 'pipe' })
    },
  }
}

/**
 * Build a Docker image from a Dockerfile and start a container.
 */
export function startContainerFromDockerfile(opts: {
  dockerfilePath: string
  env: Record<string, string>
  port: number
  readyLog: string | RegExp
}): DockerContainer {
  const absPath = path.resolve(opts.dockerfilePath)
  const dir = path.dirname(absPath)
  const tag = `sqldoc-dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const buildResult = spawnSync('docker', ['build', '-t', tag, '-f', absPath, dir], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  })

  if (buildResult.status !== 0 && buildResult.status !== null) {
    throw new Error(
      `Failed to build Docker image (exit ${buildResult.status}): ${buildResult.stderr || buildResult.stdout}`,
    )
  }
  if (buildResult.error) {
    throw new Error(`Failed to build Docker image: ${buildResult.error.message}`)
  }

  const container = startContainer({ ...opts, image: tag })

  // Override stop to also remove the built image
  const originalStop = container.stop
  container.stop = () => {
    originalStop()
    spawnSync('docker', ['rmi', tag], { stdio: 'pipe' })
  }

  return container
}

/** Poll docker logs until the ready message appears or timeout */
function waitForLog(containerId: string, pattern: string | RegExp, timeoutMs: number): void {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const logs = execSync(`docker logs ${containerId} 2>&1`, { encoding: 'utf-8' })
      if (typeof pattern === 'string' ? logs.includes(pattern) : pattern.test(logs)) {
        return
      }
    } catch {
      // Container might not be ready yet
    }
    spawnSync('sleep', ['0.5'])
  }
  spawnSync('docker', ['rm', '-f', containerId], { stdio: 'pipe' })
  throw new Error(`Container ${containerId} did not become ready within ${timeoutMs}ms`)
}
