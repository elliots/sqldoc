/**
 * High-level Atlas runner API.
 *
 * Provides inspect() and diff() functions that:
 * 1. Spawn a worker thread running the Atlas WASI module
 * 2. Handle the SharedArrayBuffer bridge loop on the main thread
 * 3. Execute SQL requests from the WASI module via the DatabaseAdapter
 * 4. Return parsed AtlasResult
 *
 * The compiled WebAssembly.Module is cached across commands.
 */

import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import {
  type BridgeBuffers,
  bridgeReadRequest,
  bridgeRespond,
  bridgeWaitForSignal,
  createBridgeBuffers,
  SIGNAL_DONE,
  SIGNAL_REQUEST,
} from './bridge.ts'
import { type DatabaseAdapter, isBun } from './db/types.ts'
import type { AtlasCommand, AtlasRename, AtlasResult } from './types.ts'

export interface AtlasRunnerOptions {
  /** Path to atlas.wasm binary */
  wasmPath: string
  /** Database adapter (pglite or pg) */
  db: DatabaseAdapter
  /** SQL dialect */
  dialect: 'postgres' | 'mysql' | 'sqlite'
  /** When true, auto-reset the adapter if Atlas's restore cleanup fails.
   *  Use in tests where the runner is reused across multiple operations. */
  autoReset?: boolean
}

/** A diff source: SQL file contents (string[]) or a live database (DatabaseAdapter). */
export type DiffSource = string[] | DatabaseAdapter

export interface AtlasRunner {
  /** Execute SQL files and return parsed schema with tags */
  inspect(files: string[], options?: { schema?: string; fileNames?: string[] }): Promise<AtlasResult>

  /** Compare two schema states. Each side can be SQL or a live database.
   * Live databases are only inspected, never written to. */
  diff(
    from: DiffSource,
    to: DiffSource,
    options?: { schema?: string; defaultSchema?: string; renames?: AtlasRename[] },
  ): Promise<AtlasResult>

  /** Clean up resources */
  close(): Promise<void>
}

/**
 * Resolve the path to the worker file (.js or .ts).
 *
 * Prefers compiled .js (production / Bun binary). Falls back to raw .ts
 * for workspace development (vitest, tsx, Node --experimental-strip-types).
 */
function resolveWorkerPath(): { workerPath: string; execArgv: string[] } {
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(thisDir, 'worker.js'), // dist/worker.js (production)
    path.resolve(thisDir, '../dist/worker.js'), // src/../dist/worker.js (legacy)
    path.resolve(thisDir, 'worker.ts'), // src/worker.ts (raw .ts dev)
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      if (candidate.endsWith('.ts') && !isBun) {
        // Node 22.21+ runs .ts natively — no loader needed for workers
        // Older Node needs tsx/cjs to register TypeScript transform
        const [major, minor] = (process.versions?.node ?? '0.0').split('.').map(Number)
        if (major > 22 || (major === 22 && minor >= 21)) {
          return { workerPath: candidate, execArgv: [] }
        }
        const atlasRequire = createRequire(candidate)
        const tsxCjs = atlasRequire.resolve('tsx/cjs')
        return { workerPath: candidate, execArgv: ['--require', tsxCjs] }
      }
      return { workerPath: candidate, execArgv: [] }
    }
  }

  throw new Error(`Cannot find worker file.\nLooked in:\n${candidates.map((c) => `  ${c}`).join('\n')}`)
}

/**
 * Run a single Atlas command via a worker thread.
 *
 * Main thread bridge loop:
 * 1. Wait for worker to signal a request via Atomics
 * 2. Read SQL from shared buffer
 * 3. Execute via DatabaseAdapter
 * 4. Write response to shared buffer
 * 5. Repeat until DONE signal
 */
async function runCommand(
  wasmPath: string,
  db: DatabaseAdapter,
  command: AtlasCommand,
  extraAdapters?: Record<string, DatabaseAdapter>,
): Promise<AtlasResult> {
  const buffers = createBridgeBuffers()
  const stdinData = JSON.stringify(command)
  const { workerPath, execArgv } = resolveWorkerPath()

  if (process.env.DEBUG) console.error(`[bridge] === new worker: ${command.type} ===`)
  return new Promise<AtlasResult>((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: {
        wasmPath,
        controlBuffer: buffers.control,
        dataBuffer: buffers.data,
        stdinData,
      },
      execArgv,
    })

    let settled = false

    worker.on('message', (msg: { type: string; stdout?: string; error?: string }) => {
      if (settled) return
      settled = true

      if (msg.type === 'error') {
        reject(new Error(`Atlas worker error: ${msg.error}`))
      } else if (msg.type === 'result') {
        try {
          const stdout = (msg.stdout ?? '').trim()
          if (!stdout) {
            resolve({})
          } else {
            resolve(JSON.parse(stdout))
          }
        } catch (_err: unknown) {
          reject(new Error(`Failed to parse Atlas output: ${msg.stdout}`))
        }
      }
    })

    worker.on('error', (err) => {
      if (settled) return
      settled = true
      reject(err)
    })

    worker.on('exit', (code) => {
      if (settled) return
      settled = true
      if (code !== 0) {
        reject(new Error(`Atlas worker exited with code ${code}`))
      }
    })

    // Start the bridge loop (runs on main thread, async)
    handleBridgeLoop(buffers, db, extraAdapters).catch((err) => {
      if (!settled) {
        settled = true
        worker.terminate()
        reject(err)
      }
    })
  })
}

/**
 * Main-thread bridge loop: handles atlas_sql requests from the worker.
 * Runs until the worker signals DONE.
 */
async function handleBridgeLoop(
  buffers: BridgeBuffers,
  db: DatabaseAdapter,
  extraAdapters?: Record<string, DatabaseAdapter>,
): Promise<void> {
  while (true) {
    const signal = await bridgeWaitForSignal(buffers)

    if (signal === SIGNAL_DONE) {
      if (process.env.DEBUG) console.error('[bridge] === DONE ===')
      break
    }

    if (signal !== SIGNAL_REQUEST) {
      // Unexpected signal -- wait again
      // Reset to idle so bridgeWaitForSignal can poll again
      const _control = new Int32Array(buffers.control)
      // If it's RESPONSE, the worker hasn't reset yet. Wait briefly.
      await new Promise((r) => setTimeout(r, 1))
      continue
    }

    // Read SQL request from shared buffer
    const reqJson = bridgeReadRequest(buffers)

    let response: Record<string, unknown>
    try {
      const req = JSON.parse(reqJson) as { type: string; sql: string; args?: unknown[]; connection?: string }

      // Route to the right adapter based on connection field
      const adapter =
        req.connection && req.connection !== 'dev' && extraAdapters?.[req.connection]
          ? extraAdapters[req.connection]
          : db

      if (process.env.DEBUG) {
        const preview = req.sql.length > 120 ? `${req.sql.substring(0, 120)}...` : req.sql
        console.error(`[bridge] ${req.type}: ${preview}`)
      }

      if (req.type === 'query') {
        const result = await adapter.query(req.sql, req.args)
        if (process.env.DEBUG) console.error(`[bridge] -> ${result.columns.length} cols, ${result.rows.length} rows`)
        response = { columns: result.columns, rows: result.rows }
      } else {
        const result = await adapter.exec(req.sql, req.args)
        if (process.env.DEBUG) console.error(`[bridge] -> ${result.rowsAffected} affected`)
        response = { rows_affected: result.rowsAffected }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      response = { error: message }
    }

    // Write response and notify worker (handle BigInt from pglite)
    bridgeRespond(
      buffers,
      JSON.stringify(response, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    )

    // After responding, the worker will reset signal to IDLE.
    // We need to wait for it to do so before calling bridgeWaitForSignal again.
    // Small yield to allow worker to process.
    await new Promise((r) => setTimeout(r, 0))
  }
}

/**
 * Create an AtlasRunner instance.
 *
 * The runner caches the compiled WebAssembly.Module (compiles atlas.wasm once).
 * Each inspect/diff call spawns a worker thread that reuses the cached module.
 */
export async function createAtlasRunner(options: AtlasRunnerOptions): Promise<AtlasRunner> {
  const { wasmPath, db, dialect, autoReset } = options

  // Verify wasm file exists
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Atlas WASM binary not found: ${wasmPath}`)
  }

  /** If Atlas reports a restore failure, reset the adapter to get a clean dev DB. */
  async function resetIfRestoreFailed(result: AtlasResult): Promise<void> {
    if (autoReset && result.error?.includes('restore:') && db.reset) {
      await db.reset()
    }
  }

  return {
    async inspect(files: string[], opts?: { schema?: string; fileNames?: string[] }): Promise<AtlasResult> {
      const command: AtlasCommand = {
        type: 'inspect',
        dialect,
        files,
        fileNames: opts?.fileNames,
        schema: opts?.schema,
      }
      const result = await runCommand(wasmPath, db, command)
      await resetIfRestoreFailed(result)
      return result
    },

    async diff(
      from: DiffSource,
      to: DiffSource,
      opts?: { schema?: string; defaultSchema?: string; renames?: AtlasRename[] },
    ): Promise<AtlasResult> {
      const fromIsDb = !Array.isArray(from)
      const toIsDb = !Array.isArray(to)
      const command: AtlasCommand = {
        type: 'diff',
        dialect,
        from: fromIsDb ? [] : from,
        to: toIsDb ? [] : to,
        schema: opts?.schema,
        defaultSchema: opts?.defaultSchema,
        renames: opts?.renames,
        fromConnection: fromIsDb ? 'from' : undefined,
        toConnection: toIsDb ? 'to' : undefined,
      }
      const extraAdapters: Record<string, DatabaseAdapter> = {}
      if (fromIsDb) extraAdapters.from = from as DatabaseAdapter
      if (toIsDb) extraAdapters.to = to as DatabaseAdapter
      const result = await runCommand(wasmPath, db, command, extraAdapters)
      await resetIfRestoreFailed(result)
      return result
    },

    async close(): Promise<void> {
      await db.close()
    },
  }
}
