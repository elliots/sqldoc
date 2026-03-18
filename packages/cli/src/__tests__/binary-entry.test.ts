import { describe, it, expect } from 'vitest'
import { isBunRuntime, isCompiledBinary } from '../runtime'

describe('runtime detection', () => {
  it('isBunRuntime returns false in Node.js', () => {
    expect(isBunRuntime()).toBe(false)
  })

  it('isCompiledBinary returns false in Node.js', () => {
    expect(isCompiledBinary()).toBe(false)
  })

  it('isCompiledBinary depends on isBunRuntime', () => {
    // If not running in Bun, compiled binary detection must also be false
    if (!isBunRuntime()) {
      expect(isCompiledBinary()).toBe(false)
    }
  })
})
