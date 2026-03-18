import { describe, expect, it } from 'vitest'
import { getWasiImports } from '../wasi-host'

describe('getWasiImports', () => {
  it('uses getImportObject when available (Node.js API)', () => {
    const mockWasi = {
      getImportObject: () => ({
        wasi_snapshot_preview1: { fd_write: () => {} },
      }),
    }
    const result = getWasiImports(mockWasi as any)
    expect(result).toHaveProperty('wasi_snapshot_preview1')
    expect(result.wasi_snapshot_preview1).toHaveProperty('fd_write')
  })

  it('uses wasiImport when getImportObject is missing (Bun API)', () => {
    const mockWasi = {
      wasiImport: { fd_write: () => {}, fd_read: () => {} },
    }
    const result = getWasiImports(mockWasi as any)
    expect(result).toHaveProperty('wasi_snapshot_preview1')
    expect(result.wasi_snapshot_preview1).toHaveProperty('fd_write')
    expect(result.wasi_snapshot_preview1).toHaveProperty('fd_read')
  })

  it('prefers getImportObject over wasiImport when both exist', () => {
    const mockWasi = {
      getImportObject: () => ({
        wasi_snapshot_preview1: { from_getImportObject: true },
      }),
      wasiImport: { from_wasiImport: true },
    }
    const result = getWasiImports(mockWasi as any)
    expect(result.wasi_snapshot_preview1).toHaveProperty('from_getImportObject')
  })

  it('throws when neither API is available', () => {
    const mockWasi = {}
    expect(() => getWasiImports(mockWasi as any)).toThrow('Cannot get WASI imports')
  })
})
