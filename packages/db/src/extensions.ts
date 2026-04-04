/**
 * PostgreSQL extension detection and validation.
 *
 * Extracts CREATE EXTENSION names from SQL and validates against
 * a real Postgres instance.
 */
import pc from 'picocolors'

/** Regex to extract extension names from CREATE EXTENSION statements */
const CREATE_EXT_RE = /CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\w[\w-]*))/gi

/**
 * Extract extension names from SQL strings.
 * Handles both quoted and unquoted names, and hyphenated names like uuid-ossp.
 */
export function extractExtensions(
  sqlFiles: string[],
  filePaths?: string[],
): { extensions: string[]; byFile: Map<string, string[]> } {
  const all = new Set<string>()
  const byFile = new Map<string, string[]>()
  for (let i = 0; i < sqlFiles.length; i++) {
    const sql = sqlFiles[i]
    const file = filePaths?.[i] ?? `file${i}`
    const lines = sql.split('\n')
    for (const line of lines) {
      // Skip commented-out lines
      if (line.trimStart().startsWith('--')) continue
      let match
      CREATE_EXT_RE.lastIndex = 0
      while ((match = CREATE_EXT_RE.exec(line)) !== null) {
        const name = (match[1] ?? match[2]).toLowerCase().replace(/-/g, '_')
        all.add(name)
        const existing = byFile.get(name) ?? []
        existing.push(file)
        byFile.set(name, existing)
      }
    }
  }
  return { extensions: [...all], byFile }
}

/**
 * Validate extensions against a real Postgres database.
 * Queries pg_available_extensions to check availability.
 */
export async function validatePostgresExtensions(
  requested: string[],
  queryFn: (sql: string) => Promise<{ rows: unknown[][] }>,
): Promise<void> {
  if (requested.length === 0) return

  const result = await queryFn(
    'SELECT name FROM pg_available_extensions WHERE name = ANY(ARRAY[' +
      requested.map((e) => `'${e}'`).join(',') +
      '])',
  )

  const available = new Set(result.rows.map((r) => String(r[0])))

  const missing = requested.filter((e) => !available.has(e))
  if (missing.length > 0) {
    const lines = requested.map((ext) => {
      const ok = available.has(ext)
      return ok ? pc.green(`  ✓ ${ext}`) : pc.red(`  ✗ ${ext}`)
    })

    throw new Error(
      `Some required extensions are not available on this database:\n${lines.join('\n')}\n\n` +
        `Install the missing extensions or use a Docker image that includes them.`,
    )
  }
}
