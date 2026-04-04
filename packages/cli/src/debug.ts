import path from 'node:path'
import { findConfigRoot, setDebugLogger } from '@sqldoc/core'

const enabled = !!process.env.DEBUG

// Wire core's debug logger to stderr when DEBUG is set
if (enabled) {
  setDebugLogger((msg) => console.error(msg))
}

export function debug(label: string, ...args: any[]) {
  if (!enabled) return
  console.error(`[${label}]`, ...args)
}

/**
 * Resolve the config root directory for a CLI command.
 * If --config is provided, uses its parent directory.
 * Otherwise walks up from cwd to find the nearest config file.
 * Falls back to cwd if no config found.
 */
export function resolveConfigRoot(configOption?: string): string {
  if (configOption) {
    return path.dirname(path.resolve(configOption))
  }
  const found = findConfigRoot(process.cwd())
  if (found) {
    debug('config', 'found config at:', found.configFile)
    return found.configRoot
  }
  debug('config', 'no config found, using cwd')
  return process.cwd()
}
