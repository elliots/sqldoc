import { describe, it } from 'node:test'
import { expect } from '@sqldoc/test-utils'
import { getWasiImports } from '../wasi-host.ts'

describe('getWasiImports', () => {
  it('uses getImportObject when available (Node.js API)', () => {
    const mockWasi = {
      getImportObject: () => ({
        wasi_snapshot_preview1: { fd_write: () => {} },
      }),
    }
    const result = getWasiImports(mockWasi as any)
    expect('wasi_snapshot_preview1' in result).toBeTruthy()
    expect('fd_write' in result.wasi_snapshot_preview1).toBeTruthy()
  })

  it('uses wasiImport when getImportObject is missing (Bun API)', () => {
    const mockWasi = {
      wasiImport: { fd_write: () => {}, fd_read: () => {} },
    }
    const result = getWasiImports(mockWasi as any)
    expect('wasi_snapshot_preview1' in result).toBeTruthy()
    expect('fd_write' in result.wasi_snapshot_preview1).toBeTruthy()
    expect('fd_read' in result.wasi_snapshot_preview1).toBeTruthy()
  })

  it('prefers getImportObject over wasiImport when both exist', () => {
    const mockWasi = {
      getImportObject: () => ({
        wasi_snapshot_preview1: { from_getImportObject: true },
      }),
      wasiImport: { from_wasiImport: true },
    }
    const result = getWasiImports(mockWasi as any)
    expect('from_getImportObject' in result.wasi_snapshot_preview1).toBeTruthy()
  })

  it('throws when neither API is available', () => {
    const mockWasi = {}
    expect(() => getWasiImports(mockWasi as any)).toThrow(/Cannot get WASI imports/)
  })
})
