/**
 * Pluggable debug logger for sqldoc core.
 *
 * Default: no-op (zero overhead when not enabled).
 * CLI sets this to console.error when DEBUG is set.
 * VSCode extension can set this to OutputChannel.
 */

let _log: (msg: string) => void = () => {}

/** Set the debug log function. Pass a no-op to disable. */
export function setDebugLogger(logger: (msg: string) => void) {
  _log = logger
}

/** Log a debug message with a label prefix. */
export function debug(label: string, msg: string) {
  _log(`[${label}] ${msg}`)
}
