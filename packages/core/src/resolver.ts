/**
 * SQL file resolver with glob expansion, transitive resolution,
 * cycle detection, dedup, and missing file error handling.
 *
 * Resolves @external and @include directives from SQL files into
 * absolute file paths with provenance tracking.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { debug } from './debug.ts'
import type { FileProvenance } from './directives.ts'
import { parseDirectives } from './directives.ts'

// -- Types --

/** Result of resolving all @external and @include directives */
export interface ResolvedFiles {
  /** Absolute paths of external SQL files (deduped) */
  externalFiles: string[]
  /** Absolute paths of included SQL files (deduped) */
  includeFiles: string[]
  /** Map from absolute file path to its provenance */
  provenanceMap: Map<string, FileProvenance>
}

// -- Resolver --

/**
 * Resolve all @external and @include directives from project SQL files.
 *
 * - Resolves paths relative to the containing file's directory
 * - Expands glob patterns using fast-glob
 * - Recursively processes referenced files for transitive directives
 * - Detects cycles via a visited set (no infinite loops)
 * - Deduplicates: each file appears at most once
 * - External takes precedence: if a file is both @external and @include, it's external
 * - Missing referenced files produce a hard error
 *
 * @param projectFiles Absolute paths of discovered project SQL files
 * @param readFile Function to read a file's content given its absolute path
 */
export async function resolveDirectives(
  projectFiles: string[],
  readFile: (path: string) => string,
): Promise<ResolvedFiles> {
  const provenanceMap = new Map<string, FileProvenance>()
  const visited = new Set<string>()

  debug('resolver', `resolveDirectives: ${projectFiles.length} project file(s)`)

  // Mark all project files
  for (const f of projectFiles) {
    provenanceMap.set(f, 'project')
  }

  // Process each project file's directives
  for (const filePath of projectFiles) {
    const content = readFile(filePath)
    await processFile(filePath, content, readFile, provenanceMap, visited)
  }

  // Build result arrays from provenance map
  const externalFiles: string[] = []
  const includeFiles: string[] = []

  for (const [filePath, provenance] of provenanceMap) {
    if (provenance === 'external') externalFiles.push(filePath)
    else if (provenance === 'include') includeFiles.push(filePath)
  }

  debug('resolver', `resolved: ${externalFiles.length} external, ${includeFiles.length} include`)
  return {
    externalFiles: externalFiles.sort(),
    includeFiles: includeFiles.sort(),
    provenanceMap,
  }
}

/**
 * Process directives in a single file, resolving paths and recursing.
 */
async function processFile(
  filePath: string,
  content: string,
  readFile: (path: string) => string,
  provenanceMap: Map<string, FileProvenance>,
  visited: Set<string>,
): Promise<void> {
  if (visited.has(filePath)) {
    debug('resolver', `cycle detected: ${filePath}`)
    return
  }
  visited.add(filePath)

  const directives = parseDirectives(content)
  const fileDir = path.dirname(filePath)

  for (const directive of directives) {
    const resolvedPaths = await resolvePath(directive.path, fileDir, filePath)

    for (const resolved of resolvedPaths) {
      const provenance = directive.type as FileProvenance

      // Set provenance: external takes precedence over include
      const existing = provenanceMap.get(resolved)
      if (!existing) {
        debug('resolver', `${directive.type}: ${resolved}`)
        provenanceMap.set(resolved, provenance)
      } else if (provenance === 'external' && existing === 'include') {
        debug('resolver', `provenance upgrade include->external: ${resolved}`)
        provenanceMap.set(resolved, 'external')
      }
      // If already external or project, keep as-is

      // Recurse into the referenced file (if not yet visited)
      if (!visited.has(resolved)) {
        const refContent = readFile(resolved)
        await processFile(resolved, refContent, readFile, provenanceMap, visited)
      }
    }
  }
}

/**
 * Resolve a directive path (possibly a glob) to absolute file paths.
 * Throws if a non-glob path doesn't exist.
 */
async function resolvePath(rawPath: string, fromDir: string, referrer: string): Promise<string[]> {
  const isGlob = rawPath.includes('*') || rawPath.includes('{') || rawPath.includes('?')

  if (isGlob) {
    const matches = fs.globSync(rawPath, { cwd: fromDir })
    const files = matches.map((f) => path.resolve(fromDir, f)).filter((f) => fs.statSync(f).isFile())
    if (files.length === 0) {
      throw new Error(`No files matched glob: ${rawPath} (referenced from ${referrer})`)
    }
    return files.sort()
  }

  // Package path (not relative) — resolve from project's node_modules/
  if (!rawPath.startsWith('.') && !rawPath.startsWith('/')) {
    const projectDir = findPackageJsonDir(fromDir)
    if (!projectDir) {
      throw new Error(`Cannot resolve '${rawPath}': no package.json found (referenced from ${referrer})`)
    }
    const abs = path.resolve(projectDir, 'node_modules', rawPath)
    if (!fs.existsSync(abs)) {
      throw new Error(`File not found: ${rawPath} in node_modules/ (referenced from ${referrer})`)
    }
    return [abs]
  }

  // Relative path: resolve from containing file's directory
  const abs = path.resolve(fromDir, rawPath)
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${rawPath} (referenced from ${referrer})`)
  }
  return [abs]
}

/** Walk up from startDir to find the nearest directory containing package.json */
function findPackageJsonDir(startDir: string): string | null {
  let current = path.resolve(startDir)
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}
