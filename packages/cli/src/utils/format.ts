import type { Diagnostic } from '@sqldoc/core'
import pc from 'picocolors'

/**
 * Format a diagnostic for terminal display.
 * Output: filePath:line:col: severity: message
 * Lines and columns are 1-based for editor compatibility.
 */
export function formatDiagnostic(filePath: string, d: Diagnostic): string {
  const location = `${filePath}:${d.line + 1}:${d.startCol + 1}`
  const severity =
    d.severity === 'error' ? pc.red(d.severity) : d.severity === 'warning' ? pc.yellow(d.severity) : pc.blue(d.severity)
  return `${location}: ${severity}: ${d.message}`
}

/**
 * Format a summary line with error and warning counts.
 */
export function formatSummary(errorCount: number, warningCount: number): string {
  const errors = errorCount > 0 ? pc.red(`${errorCount} error(s)`) : `${errorCount} error(s)`
  const warnings = warningCount > 0 ? pc.yellow(`${warningCount} warning(s)`) : `${warningCount} warning(s)`
  return `${errors}, ${warnings}`
}
