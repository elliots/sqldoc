/**
 * PostgreSQL extension detection and validation.
 *
 * Extracts CREATE EXTENSION names from SQL, validates against pglite
 * or real Postgres, and provides helpful error messages.
 */
import { createRequire } from 'node:module'
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
 * Validate extensions for pglite by attempting to import them.
 * Returns the list of extensions that are available.
 * Throws with a pretty error if any are not available.
 */
export async function validatePgliteExtensions(requested: string[]): Promise<string[]> {
  if (requested.length === 0) return []

  // Resolve from this package's directory (pglite is a dep of @sqldoc/atlas)
  const req = createRequire(import.meta.url)

  const results: Array<{ name: string; available: boolean }> = []

  for (const ext of requested) {
    let found = false
    try {
      req.resolve(`@electric-sql/pglite/contrib/${ext}`)
      found = true
    } catch {}
    if (!found)
      try {
        req.resolve(`@electric-sql/pglite/${ext}`)
        found = true
      } catch {}
    results.push({ name: ext, available: found })
  }

  const unavailable = results.filter((r) => !r.available)
  if (unavailable.length > 0) {
    const lines = results.map((r) => (r.available ? pc.green(`  ✓ ${r.name}`) : pc.red(`  ✗ ${r.name}`)))

    throw new Error(
      `Some extensions are not available for the embedded postgres database:\n${lines.join('\n')}\n\n` +
        `Use a Docker image with these extensions installed as devUrl:\n` +
        `  ${pc.cyan('docker://<image>')}        — use an image that includes the extension\n` +
        `  ${pc.cyan('dockerfile://path')}       — build a custom Dockerfile with the extension`,
    )
  }

  return requested
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
