/**
 * Worker thread entry point for Atlas WASI execution.
 *
 * This file runs inside a node:worker_threads Worker. It:
 * 1. Receives initialization data via workerData
 * 2. Creates the atlas_sql callback using SharedArrayBuffer + Atomics
 * 3. Runs the WASI module with the stdin data
 * 4. Posts the stdout result back to the parent
 *
 * The atlas_sql callback bridges synchronous WASM calls to the main thread's
 * async database adapter using Atomics.wait (blocking on the worker thread).
 */

import { parentPort, workerData } from 'node:worker_threads'
import { type BridgeBuffers, bridgeRequest, SIGNAL_DONE } from './bridge.ts'
import { runWasi } from './wasi-host.ts'

interface WorkerInit {
  wasmPath: string
  controlBuffer: SharedArrayBuffer
  dataBuffer: SharedArrayBuffer
  stdinData: string
}

const { wasmPath, controlBuffer, dataBuffer, stdinData } = workerData as WorkerInit

const buffers: BridgeBuffers = {
  control: controlBuffer,
  data: dataBuffer,
}

// WASM instance memory -- set via onInstance before wasi.start()
let wasmMemory: WebAssembly.Memory | null = null

/**
 * The atlas_sql host function that bridges sync WASM calls
 * to the main thread via SharedArrayBuffer + Atomics.
 *
 * Signature matches Go's //go:wasmimport env atlas_sql:
 *   (reqPtr, reqLen, respPtr, respCap) => int64
 *
 * Negative return = buffer too small (abs value = needed size).
 * Positive return = actual response length written.
 */
function atlasSql(reqPtr: number, reqLen: number, respPtr: number, respCap: number): bigint {
  if (!wasmMemory) {
    throw new Error('WASM memory not yet available in atlas_sql callback')
  }

  // 1. Read request JSON from WASM memory
  const reqBytes = new Uint8Array(wasmMemory.buffer, reqPtr, reqLen)
  const requestJson = new TextDecoder().decode(reqBytes.slice())

  // 2. Send request to main thread via bridge and block until response
  const responseJson = bridgeRequest(buffers, requestJson)

  // 3. Encode response and check capacity
  const respEncoded = new TextEncoder().encode(responseJson)

  if (respEncoded.byteLength > respCap) {
    return BigInt(-respEncoded.byteLength)
  }

  // 4. Copy response into WASM memory
  const wasmResp = new Uint8Array(wasmMemory.buffer, respPtr, respCap)
  wasmResp.set(respEncoded)

  return BigInt(respEncoded.byteLength)
}

async function main(): Promise<void> {
  if (!parentPort) {
    throw new Error('worker.ts must run inside a worker thread')
  }

  try {
    const result = await runWasi({
      stdinData,
      wasmPath,
      atlasSqlFn: atlasSql,
      onInstance(instance) {
        // Capture WASM memory before execution starts.
        // atlas_sql will use this to read requests from / write responses to WASM memory.
        wasmMemory = instance.exports.memory as WebAssembly.Memory
      },
    })

    // Signal main thread that WASI execution is done
    const control = new Int32Array(buffers.control)
    Atomics.store(control, 0, SIGNAL_DONE)
    Atomics.notify(control, 0)

    // Post result back
    parentPort.postMessage({ type: 'result', stdout: result.stdout })
  } catch (err: unknown) {
    // Signal done even on error
    const control = new Int32Array(buffers.control)
    Atomics.store(control, 0, SIGNAL_DONE)
    Atomics.notify(control, 0)

    const message = err instanceof Error ? err.message : String(err)
    parentPort.postMessage({ type: 'error', error: message })
  }
}

main()