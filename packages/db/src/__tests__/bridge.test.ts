import { describe, expect, it } from '@sqldoc/test-utils'
import {
  bridgeReadRequest,
  bridgeRespond,
  bridgeWaitForSignal,
  createBridgeBuffers,
  SIGNAL_DONE,
  SIGNAL_IDLE,
  SIGNAL_REQUEST,
  SIGNAL_RESPONSE,
} from '../bridge.ts'

describe('bridge', () => {
  describe('createBridgeBuffers', () => {
    it('creates control buffer of 8 bytes', () => {
      const buffers = createBridgeBuffers()
      expect(buffers.control.byteLength).toBe(8)
    })

    it('creates data buffer with default 8MB size', () => {
      const buffers = createBridgeBuffers()
      expect(buffers.data.byteLength).toBe(8 * 1024 * 1024)
    })

    it('creates data buffer with custom size', () => {
      const buffers = createBridgeBuffers(4096)
      expect(buffers.data.byteLength).toBe(4096)
    })

    it('initializes control buffer to idle state', () => {
      const buffers = createBridgeBuffers()
      const control = new Int32Array(buffers.control)
      expect(Atomics.load(control, 0)).toBe(SIGNAL_IDLE)
      expect(Atomics.load(control, 1)).toBe(0)
    })
  })

  describe('round-trip communication', () => {
    it('writes request data to shared buffer and sets signal', async () => {
      const buffers = createBridgeBuffers(4096)
      const control = new Int32Array(buffers.control)

      // Simulate worker writing a request (in a real scenario, this blocks)
      // We manually do the steps bridgeRequest does, without blocking
      const request = '{"type":"query","sql":"SELECT 1"}'
      const encoded = new TextEncoder().encode(request)
      new Uint8Array(buffers.data).set(encoded)
      Atomics.store(control, 1, encoded.byteLength)
      Atomics.store(control, 0, SIGNAL_REQUEST)

      // Main thread reads the request
      const reqJson = bridgeReadRequest(buffers)
      expect(reqJson).toBe(request)
      expect(JSON.parse(reqJson)).toEqual({ type: 'query', sql: 'SELECT 1' })
    })

    it('respond writes data and sets response signal', () => {
      const buffers = createBridgeBuffers(4096)
      const control = new Int32Array(buffers.control)

      // Simulate: signal is currently REQUEST (worker is waiting)
      Atomics.store(control, 0, SIGNAL_REQUEST)

      // Main thread writes response
      const response = '{"columns":["num"],"rows":[[1]]}'
      bridgeRespond(buffers, response)

      // Verify response was written
      expect(Atomics.load(control, 0)).toBe(SIGNAL_RESPONSE)
      const respLen = Atomics.load(control, 1)
      const respBytes = new Uint8Array(buffers.data, 0, respLen)
      const respJson = new TextDecoder().decode(respBytes)
      expect(respJson).toBe(response)
    })

    it('handles large payloads near buffer size', () => {
      const buffers = createBridgeBuffers(2048)
      const control = new Int32Array(buffers.control)

      // Create a payload just under 2048 bytes
      const largeData = JSON.stringify({ rows: Array(50).fill(['x'.repeat(30)]) })
      expect(largeData.length < 2048).toBeTruthy()

      const encoded = new TextEncoder().encode(largeData)
      new Uint8Array(buffers.data).set(encoded)
      Atomics.store(control, 1, encoded.byteLength)
      Atomics.store(control, 0, SIGNAL_REQUEST)

      const readBack = bridgeReadRequest(buffers)
      expect(readBack).toBe(largeData)
    })

    it('bridgeRespond handles oversized response gracefully', () => {
      const buffers = createBridgeBuffers(64) // very small buffer
      const control = new Int32Array(buffers.control)
      Atomics.store(control, 0, SIGNAL_REQUEST)

      // Try to write a response larger than the buffer
      const bigResponse = JSON.stringify({ columns: ['a'], rows: Array(100).fill([1]) })
      expect(new TextEncoder().encode(bigResponse).byteLength > 64).toBeTruthy()

      // Should write error response instead of crashing
      bridgeRespond(buffers, bigResponse)

      expect(Atomics.load(control, 0)).toBe(SIGNAL_RESPONSE)
      const respLen = Atomics.load(control, 1)
      const respBytes = new Uint8Array(buffers.data, 0, respLen)
      const respJson = new TextDecoder().decode(respBytes)
      const parsed = JSON.parse(respJson)
      expect(parsed.error).toContain('too large')
    })
  })

  describe('signal management', () => {
    it('bridgeWaitForSignal returns immediately for non-idle signal', async () => {
      const buffers = createBridgeBuffers(256)
      const control = new Int32Array(buffers.control)

      // Set signal to REQUEST
      Atomics.store(control, 0, SIGNAL_REQUEST)

      const signal = await bridgeWaitForSignal(buffers)
      expect(signal).toBe(SIGNAL_REQUEST)
    })

    it('bridgeWaitForSignal returns DONE signal', async () => {
      const buffers = createBridgeBuffers(256)
      const control = new Int32Array(buffers.control)

      Atomics.store(control, 0, SIGNAL_DONE)

      const signal = await bridgeWaitForSignal(buffers)
      expect(signal).toBe(SIGNAL_DONE)
    })
  })

  describe('full request-response cycle (simulated)', () => {
    it('simulates a complete request/response exchange', () => {
      const buffers = createBridgeBuffers(4096)
      const control = new Int32Array(buffers.control)

      // Step 1: Worker writes request
      const request = '{"type":"exec","sql":"CREATE TABLE t (id int)"}'
      const reqEncoded = new TextEncoder().encode(request)
      new Uint8Array(buffers.data).set(reqEncoded)
      Atomics.store(control, 1, reqEncoded.byteLength)
      Atomics.store(control, 0, SIGNAL_REQUEST)

      // Step 2: Main reads request
      expect(Atomics.load(control, 0)).toBe(SIGNAL_REQUEST)
      const readReq = bridgeReadRequest(buffers)
      expect(JSON.parse(readReq)).toEqual({
        type: 'exec',
        sql: 'CREATE TABLE t (id int)',
      })

      // Step 3: Main writes response
      bridgeRespond(buffers, '{"rows_affected":0}')

      // Step 4: Worker reads response
      expect(Atomics.load(control, 0)).toBe(SIGNAL_RESPONSE)
      const respLen = Atomics.load(control, 1)
      const respBytes = new Uint8Array(buffers.data, 0, respLen)
      const respJson = new TextDecoder().decode(respBytes)
      expect(JSON.parse(respJson)).toEqual({ rows_affected: 0 })

      // Step 5: Reset to idle for next exchange
      Atomics.store(control, 0, SIGNAL_IDLE)
      expect(Atomics.load(control, 0)).toBe(SIGNAL_IDLE)
    })

    it('simulates multiple sequential round-trips', () => {
      const buffers = createBridgeBuffers(4096)
      const control = new Int32Array(buffers.control)

      const exchanges = [
        {
          req: '{"type":"exec","sql":"CREATE TABLE t (id int)"}',
          resp: '{"rows_affected":0}',
        },
        {
          req: '{"type":"query","sql":"SELECT column_name FROM information_schema.columns"}',
          resp: '{"columns":["column_name"],"rows":[["id"]]}',
        },
      ]

      for (const exchange of exchanges) {
        // Worker writes request
        const reqEncoded = new TextEncoder().encode(exchange.req)
        new Uint8Array(buffers.data).set(reqEncoded)
        Atomics.store(control, 1, reqEncoded.byteLength)
        Atomics.store(control, 0, SIGNAL_REQUEST)

        // Main reads and responds
        const readReq = bridgeReadRequest(buffers)
        expect(readReq).toBe(exchange.req)
        bridgeRespond(buffers, exchange.resp)

        // Worker reads response
        const respLen = Atomics.load(control, 1)
        const respBytes = new Uint8Array(buffers.data, 0, respLen)
        const respJson = new TextDecoder().decode(respBytes)
        expect(respJson).toBe(exchange.resp)

        // Reset
        Atomics.store(control, 0, SIGNAL_IDLE)
      }
    })
  })
})
