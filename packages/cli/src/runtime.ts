/**
 * Runtime detection helpers for the sqldoc CLI.
 * Used by binary-entry.ts to determine execution context.
 *
 * In Node.js (dev mode), both return false.
 * In a Bun-compiled binary, both return true.
 */

/** Whether we're running inside a Bun runtime (compiled or not) */
export function isBunRuntime(): boolean {
  return typeof (globalThis as any).Bun !== 'undefined'
}

/** Whether we're running as a Bun-compiled binary (not just bun CLI) */
export function isCompiledBinary(): boolean {
  return isBunRuntime() && process.execPath.includes('sqldoc')
}
