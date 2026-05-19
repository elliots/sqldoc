import * as path from 'node:path'
import { findConfigRoot, loadConfig, resolveProject, type Dialect } from '@sqldoc/core'

/** Resolve the SQL dialect the extension should use for a workspace file. */
export async function resolveWorkspaceDialect(documentPath: string): Promise<Dialect> {
  const found = findConfigRoot(path.dirname(documentPath))
  if (!found) return 'postgres'

  try {
    const { config } = await loadConfig(found.configRoot, found.configFile)
    return resolveProject(config).dialect
  } catch {
    return 'postgres'
  }
}
