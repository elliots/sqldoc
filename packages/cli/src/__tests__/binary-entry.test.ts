import { describe, it, expect } from 'vitest'
import { isBunRuntime, isCompiledBinary } from '../runtime'

describe('runtime detection', () => {
  it('isBunRuntime detects the current runtime correctly', () => {
    const isBun = typeof (globalThis as any).Bun !== 'undefined'
    expect(isBunRuntime()).toBe(isBun)
  })

  it('isCompiledBinary returns false in dev mode', () => {
    // In dev mode (not a compiled binary), this should be false regardless of runtime
    if (!isBunRuntime()) {
      expect(isCompiledBinary()).toBe(false)
    }
  })

  it('isCompiledBinary depends on isBunRuntime', () => {
    // If not running in Bun, compiled binary detection must also be false
    if (!isBunRuntime()) {
      expect(isCompiledBinary()).toBe(false)
    }
  })
})
