/**
 * Sync/async bridge for atlas_sql host function.
 *
 * Architecture:
 * - Worker thread runs WASI module, calls atlas_sql synchronously
 * - atlas_sql writes SQL request to shared buffer, signals main thread, blocks via Atomics.wait
 * - Main thread receives request, runs async DB query, writes response, signals via Atomics.notify
 *
 * Control buffer layout (Int32Array over SharedArrayBuffer):
 *   [0] = signal: 0=idle, 1=request_ready, 2=response_ready, 3=done
 *   [1] = data length (request or response)
 */

// Signal constants
export const SIGNAL_IDLE = 0
export const SIGNAL_REQUEST = 1
export const SIGNAL_RESPONSE = 2
export const SIGNAL_DONE = 3

/**
 * Shared buffers passed between main and worker thread.
 */
export interface BridgeBuffers {
  /** 8 bytes: signal (Int32) + data length (Int32) */
  control: SharedArrayBuffer
  /** Data exchange buffer (default 1MB, resizable) */
  data: SharedArrayBuffer
}

/**
 * Create shared buffers for bridge communication.
 * @param dataSize Initial data buffer size in bytes (default 8MB)
 */
export function createBridgeBuffers(dataSize = 8 * 1024 * 1024): BridgeBuffers {
  return {
    control: new SharedArrayBuffer(8),
    data: new SharedArrayBuffer(dataSize),
  }
}

// ── Worker-side (synchronous) ───────────────────────────────────────

/**
 * Write a request to the shared buffer and block until a response is available.
 * Called from the worker thread inside the atlas_sql host function.
 *
 * @returns Response JSON string
 */
export function bridgeRequest(buffers: BridgeBuffers, requestJson: string): string {
  const control = new Int32Array(buffers.control)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  // Write request to data buffer
  const encoded = encoder.encode(requestJson)
  if (encoded.byteLength > buffers.data.byteLength) {
    throw new Error(`Bridge request too large: ${encoded.byteLength} bytes > ${buffers.data.byteLength} buffer`)
  }
  new Uint8Array(buffers.data).set(encoded)

  // Store length and signal request ready
  Atomics.store(control, 1, encoded.byteLength)
  Atomics.store(control, 0, SIGNAL_REQUEST)
  Atomics.notify(control, 0)

  // Block until response is ready (value changes from SIGNAL_REQUEST)
  Atomics.wait(control, 0, SIGNAL_REQUEST)

  // Read response
  const signal = Atomics.load(control, 0)
  if (signal === SIGNAL_DONE) {
    throw new Error('Bridge terminated while waiting for response')
  }

  const respLen = Atomics.load(control, 1)
  const respBytes = new Uint8Array(buffers.data, 0, respLen)
  const response = decoder.decode(respBytes.slice())

  // Reset signal to idle for next round-trip
  Atomics.store(control, 0, SIGNAL_IDLE)

  return response
}

// ── Main-thread side (asynchronous) ─────────────────────────────────

/**
 * Wait for the worker to post a request. Uses Atomics.waitAsync
 * (non-blocking on the main thread).
 *
 * @returns The current signal value after waking
 */
export async function bridgeWaitForSignal(buffers: BridgeBuffers): Promise<number> {
  const control = new Int32Array(buffers.control)

  // If signal is already non-idle, return immediately
  const current = Atomics.load(control, 0)
  if (current !== SIGNAL_IDLE) {
    return current
  }

  // Wait asynchronously for signal to change from IDLE
  const result = Atomics.waitAsync(control, 0, SIGNAL_IDLE)
  if (result.async) {
    await result.value
  }
  return Atomics.load(control, 0)
}

/**
 * Read the request JSON from the shared data buffer.
 * Call after bridgeWaitForSignal returns SIGNAL_REQUEST.
 */
export function bridgeReadRequest(buffers: BridgeBuffers): string {
  const control = new Int32Array(buffers.control)
  const reqLen = Atomics.load(control, 1)
  const reqBytes = new Uint8Array(buffers.data, 0, reqLen)
  return new TextDecoder().decode(reqBytes.slice())
}

/**
 * Write a response to the shared buffer and notify the worker.
 */
export function bridgeRespond(buffers: BridgeBuffers, responseJson: string): void {
  const control = new Int32Array(buffers.control)
  const encoded = new TextEncoder().encode(responseJson)

  if (encoded.byteLength > buffers.data.byteLength) {
    // Write an error response instead -- the data buffer is too small
    const errorResp = JSON.stringify({
      error: `Response too large: ${encoded.byteLength} bytes exceeds ${buffers.data.byteLength} byte buffer`,
    })
    const errorEncoded = new TextEncoder().encode(errorResp)
    new Uint8Array(buffers.data).set(errorEncoded)
    Atomics.store(control, 1, errorEncoded.byteLength)
  } else {
    new Uint8Array(buffers.data).set(encoded)
    Atomics.store(control, 1, encoded.byteLength)
  }

  Atomics.store(control, 0, SIGNAL_RESPONSE)
  Atomics.notify(control, 0)
}

/**
 * Signal the worker that processing is done (no more commands).
 */
export function bridgeSignalDone(buffers: BridgeBuffers): void {
  const control = new Int32Array(buffers.control)
  Atomics.store(control, 0, SIGNAL_DONE)
  Atomics.notify(control, 0)
}
