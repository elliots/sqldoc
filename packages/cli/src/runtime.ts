/**
 * Runtime detection helpers for the sqldoc CLI.
 * Used by binary-entry.ts to determine execution context.
 *
 * In Node.js (dev mode), both return false.
 * In a Bun-compiled binary, both return true.
 */

/** Whether we're running inside a Bun runtime (compiled or not) */
export function isBunRuntime(): boolean {
  return !!process.versions.bun
}

declare const COMPILED_SQLDOC: boolean | undefined

/** Whether we're running as a Bun-compiled binary */
export function isCompiledBinary(): boolean {
  return typeof COMPILED_SQLDOC !== 'undefined' && COMPILED_SQLDOC === true
}
