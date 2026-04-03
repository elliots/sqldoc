/**
 * Load a TypeScript or JavaScript module at runtime.
 *
 * - Bun (compiled binary or bun dev): native import() for .ts files.
 * - Node.js: bundle-require (esbuild under the hood) for .ts files.
 * - Plain JS/npm packages: native import() on both runtimes.
 *
 * In the VSCode extension, esbuild is aliased to esbuild-wasm.
 *
 * IMPORTANT: bundle-require is dynamically imported so it is NOT loaded
 * when running in Bun. This prevents the compiled binary from needing esbuild.
 */

import { createRequire } from 'node:module'
import * as path from 'node:path'

const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts'])

/**
 * Detect if the runtime can natively import .ts files.
 * - Bun: always
 * - Node with tsx: tsx registers a loader that handles .ts
 * - Node 23.6+: --experimental-strip-types (unflagged)
 */
function canNativelyImportTs(): boolean {
  // Bun
  if (typeof process.versions?.bun === 'string') return true
  // tsx registers itself via --require or --loader
  if (process.execArgv?.some((a) => a.includes('tsx'))) return true
  // Node with amaro/strip-types flag
  if (process.execArgv?.some((a) => a.includes('strip-types'))) return true
  // Node 22.6+ supports --experimental-strip-types, 23.6+ unflagged
  // Node 22.21+ runs .ts natively without any flags
  const nodeVersion = process.versions?.node
  if (nodeVersion) {
    const [major, minor] = nodeVersion.split('.').map(Number)
    if (major > 22 || (major === 22 && minor >= 21)) return true
  }
  return false
}

/**
 * Import a TypeScript or JavaScript module by specifier.
 * Handles npm packages (via require.resolve), relative paths, and absolute paths.
 */
export async function tsImport(specifier: string, fromDir?: string): Promise<any> {
  const abs = resolveSpecifier(specifier, fromDir)

  if (TS_EXTENSIONS.has(path.extname(abs))) {
    const isNodeModules = abs.includes('/node_modules/') || abs.includes('\\node_modules\\')
    if (canNativelyImportTs() && !isNodeModules) {
      // Bun and Node 22.21+ run TypeScript natively -- but Node refuses
      // to strip types inside node_modules, so fall through to bundle-require
      return import(abs)
    }
    if (typeof process.versions?.bun === 'string') {
      // Bun handles .ts inside node_modules natively
      return import(abs)
    }
    // Node: use bundle-require (esbuild) to transpile .ts at runtime
    const { bundleRequire } = await import('bundle-require')
    return (await bundleRequire({ filepath: abs })).mod
  }

  return import(abs)
}

function resolveSpecifier(specifier: string, fromDir?: string): string {
  if (path.isAbsolute(specifier)) return specifier
  if (specifier.startsWith('.')) return path.resolve(specifier)

  // npm package — resolve from caller's directory (or cwd as fallback)
  const base = fromDir || process.cwd()
  const req = createRequire(path.join(base, 'noop.js'))
  return req.resolve(specifier)
}
