/**
 * Cross-runtime mock/spy helper.
 *
 * Works on both Node.js and Bun without importing runtime-specific
 * mock APIs (Bun does not support node:test mocking -- oven-sh/bun#24255).
 */

export function mockMethod<T extends object>(obj: T, method: string & keyof T, impl?: (...args: any[]) => any) {
  const original = (obj as any)[method]
  const calls: any[][] = []
  ;(obj as any)[method] = (...args: any[]) => {
    calls.push(args)
    return impl ? impl(...args) : undefined
  }
  return {
    calls,
    callCount: () => calls.length,
    restore: () => {
      ;(obj as any)[method] = original
    },
  }
}
