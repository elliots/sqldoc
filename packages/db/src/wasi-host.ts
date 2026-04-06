/**
 * WASI module instantiation with custom atlas_sql host function import.
 *
 * Includes workarounds for Bun's WASI bugs:
 *   1. FD_MAP ignores stdin/stdout/stderr constructor options
 *   2. random_get returns byte count instead of errno 0
 *   3. proc_exit calls process.exit() instead of throwing
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { WASI } from 'node:wasi'

const isBun = typeof (globalThis as any).Bun !== 'undefined'

/** Sentinel thrown by Bun proc_exit workaround */
class WASIExitError {
  code: number
  constructor(code: number) {
    this.code = code
  }
}

/**
 * Get WASI imports compatible with both Node.js and Bun.
 */
export function getWasiImports(wasi: WASI): Record<string, any> {
  if (typeof (wasi as any).getImportObject === 'function') {
    return (wasi as any).getImportObject()
  }
  if ((wasi as any).wasiImport) {
    return { wasi_snapshot_preview1: (wasi as any).wasiImport }
  }
  throw new Error('Cannot get WASI imports: neither getImportObject() nor wasiImport available')
}

export interface WasiRunOptions {
  stdinData: string
  wasmPath: string
  compiledModule?: WebAssembly.Module
  atlasSqlFn: (reqPtr: number, reqLen: number, respPtr: number, respCap: number) => bigint | number
  onInstance?: (instance: WebAssembly.Instance) => void
}

export interface WasiRunResult {
  stdout: string
  module: WebAssembly.Module
}

export async function runWasi(options: WasiRunOptions): Promise<WasiRunResult> {
  const { stdinData, wasmPath, atlasSqlFn, onInstance } = options
  const uid = crypto.randomUUID()
  const tmpDir = os.tmpdir()
  const stdinPath = path.join(tmpDir, `atlas-stdin-${uid}.json`)
  const stdoutPath = path.join(tmpDir, `atlas-stdout-${uid}.json`)

  let stdinFd: number | undefined
  let stdoutFd: number | undefined

  try {
    fs.writeFileSync(stdinPath, stdinData)
    fs.writeFileSync(stdoutPath, '')

    stdinFd = fs.openSync(stdinPath, 'r')
    stdoutFd = fs.openSync(stdoutPath, 'w')

    const wasi = new WASI({
      version: 'preview1',
      stdin: stdinFd,
      stdout: stdoutFd,
      returnOnExit: true,
    })

    // Bun bug #1: FD_MAP ignores constructor options
    if (isBun) {
      const fdMap: Map<number, any> = (wasi as any).FD_MAP
      if (fdMap) {
        const fd0 = fdMap.get(0)
        if (fd0) fd0.real = stdinFd
        const fd1 = fdMap.get(1)
        if (fd1) fd1.real = stdoutFd
        const fd2 = fdMap.get(2)
        if (fd2) fd2.real = 2
      }
    }

    // Compile module (or reuse cached)
    let wasmModule = options.compiledModule
    if (!wasmModule) {
      const wasmBytes = fs.readFileSync(wasmPath)
      wasmModule = await WebAssembly.compile(wasmBytes as BufferSource)
    }

    // Build imports
    const wasiImports = getWasiImports(wasi)
    let instanceRef: WebAssembly.Instance | undefined

    if (isBun && wasiImports.wasi_snapshot_preview1) {
      // Bun bug #2: random_get returns byte count instead of errno 0
      wasiImports.wasi_snapshot_preview1.random_get = (bufPtr: number, bufLen: number) => {
        if (instanceRef) {
          const mem = instanceRef.exports.memory as WebAssembly.Memory
          const view = new Uint8Array(mem.buffer, bufPtr, bufLen)
          crypto.getRandomValues(view)
        }
        return 0
      }

      // Bun bug #3: proc_exit calls process.exit()
      wasiImports.wasi_snapshot_preview1.proc_exit = (code: number) => {
        throw new WASIExitError(code)
      }
    }

    const imports = {
      ...wasiImports,
      env: { atlas_sql: atlasSqlFn },
    }

    // Instantiate
    const instance = await WebAssembly.instantiate(wasmModule, imports)
    instanceRef = instance

    if (isBun && typeof (wasi as any).setMemory === 'function') {
      ;(wasi as any).setMemory(instance.exports.memory)
    }

    if (onInstance) {
      onInstance(instance)
    }

    // Run
    try {
      if (isBun) {
        ;(instance.exports._start as Function)()
      } else {
        wasi.start(instance)
      }
    } catch (err: unknown) {
      if (err instanceof WASIExitError) {
        // Bun sentinel — non-zero exit is fine, we read stdout for error JSON
      } else {
        // Node: returnOnExit throws on non-zero exit code
        const isExitError = err instanceof Error && ('code' in err || err.message.includes('exit'))
        if (!isExitError) throw err
      }
    }

    // Close fds before reading stdout
    fs.closeSync(stdinFd)
    stdinFd = undefined
    fs.closeSync(stdoutFd)
    stdoutFd = undefined

    const stdout = fs.readFileSync(stdoutPath, 'utf-8')
    return { stdout, module: wasmModule }
  } finally {
    if (stdinFd !== undefined)
      try {
        fs.closeSync(stdinFd)
      } catch {}
    if (stdoutFd !== undefined)
      try {
        fs.closeSync(stdoutFd)
      } catch {}
    try {
      fs.unlinkSync(stdinPath)
    } catch {}
    try {
      fs.unlinkSync(stdoutPath)
    } catch {}
  }
}
