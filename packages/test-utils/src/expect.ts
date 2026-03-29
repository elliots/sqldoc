/**
 * Cross-runtime expect() re-export.
 *
 * Bun cannot resolve the npm `expect` package via ESM imports due to
 * CJS interop issues. This module detects the runtime and uses bun:test's
 * built-in expect when running in Bun, falling back to the npm package
 * for Node.js.
 */

let _expect: typeof import('expect').expect

const isBun = typeof (globalThis as any).Bun !== 'undefined'
if (isBun) {
  // @ts-expect-error -- bun:test only exists in Bun runtime
  _expect = (await import('bun:test')).expect
} else {
  _expect = (await import('expect')).expect
}

export const expect = _expect
