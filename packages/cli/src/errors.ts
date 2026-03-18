/**
 * CLI error with an exit code and user-friendly message.
 * Thrown by command functions, caught at the entry point.
 */
export class CliError extends Error {
  exitCode: number
  constructor(message: string, exitCode: number = 1) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

/**
 * Format a pipeline error into a user-friendly CliError.
 * Handles ECONNREFUSED (database not reachable) and falls back to the raw message.
 */
export function formatPipelineError(err: any, config: { devUrl?: string }): CliError {
  const msg =
    err?.code === 'ECONNREFUSED'
      ? `Cannot connect to database${config.devUrl ? ` at ${config.devUrl}` : ''}. Is it running?`
      : (err?.message ?? String(err))
  return new CliError(msg)
}
