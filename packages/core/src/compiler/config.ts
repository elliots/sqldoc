import * as fs from 'node:fs'
import * as path from 'node:path'
import { tsImport } from '../ts-import.ts'
import { unwrapDefault } from '../utils.ts'
import type { ProjectConfig, ResolvedConfig, SqldocConfig } from './types.ts'

const CONFIG_FILENAMES = ['sqldoc.config.ts', 'sqldoc.config.js', 'sqldoc.config.mjs']

/**
 * Find the closest config file by walking up from startDir.
 * Stops at the project root (directory containing .sqldoc/) or filesystem root.
 * Returns { configRoot, configFile } or null if not found.
 */
export function findConfigRoot(startDir: string = process.cwd()): { configRoot: string; configFile: string } | null {
  const projectRoot = process.env.SQLDOC_PROJECT_ROOT
  let current = path.resolve(startDir)

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(current, filename)
      if (fs.existsSync(candidate)) {
        return { configRoot: current, configFile: candidate }
      }
    }

    // Stop at project root (don't go above .sqldoc/ parent)
    if (projectRoot && current === path.resolve(projectRoot)) break

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}

export interface ConfigResult {
  config: SqldocConfig
  configPath: string | null
}

/**
 * Helper for creating typed sqldoc config.
 * Used in sqldoc.config.ts: export default defineConfig({ ... })
 * Accepts a single ProjectConfig or an array for multi-project.
 */
export function defineConfig(config: SqldocConfig): SqldocConfig {
  return config
}

/**
 * Resolve a single project from the config.
 *
 * - If config is a single ProjectConfig, returns it directly
 *   (projectName must be undefined or match config.name)
 * - If config is an array, requires projectName to select one
 * - Throws with available project names on mismatch
 */
export function resolveProject(config: SqldocConfig, projectName?: string): ResolvedConfig {
  // Single project config
  if (!Array.isArray(config)) {
    if (projectName && config.name && config.name !== projectName) {
      throw new Error(`Project "${projectName}" not found. Available: ${config.name}`)
    }
    return config
  }

  // Multi-project config
  const names = config.map((p) => p.name).filter(Boolean)

  if (projectName) {
    const found = config.find((p) => p.name === projectName)
    if (!found) {
      throw new Error(`Project "${projectName}" not found. Available: ${names.join(', ')}`)
    }
    return found
  }

  // No --project specified
  if (config.length === 1) {
    return config[0]
  }

  throw new Error(`Multiple projects configured. Use --project <name> or --all.\nAvailable: ${names.join(', ')}`)
}

/**
 * Resolve all projects from the config.
 * Returns an array regardless of single/multi config.
 */
export function resolveAllProjects(config: SqldocConfig): ProjectConfig[] {
  return Array.isArray(config) ? config : [config]
}

/**
 * Load a config file by exact path using tsx.
 */
async function loadConfigFile(configPath: string): Promise<ConfigResult> {
  const abs = path.resolve(configPath)
  let mod = (await tsImport(abs)) as any
  // Unwrap ESM default exports (CJS compat can double-wrap)
  // Detect both single config (has namespaces/dialect/schema) and arrays
  mod = unwrapDefault(mod, (m: any) => !!m.namespaces || !!m.dialect || !!m.schema || Array.isArray(m))
  const config: SqldocConfig = mod ?? { dialect: 'postgres' }
  return { config, configPath: abs }
}

/**
 * Load sqldoc config.
 * If configFile is provided, loads that exact file.
 * Otherwise searches projectRoot for sqldoc.config.{ts,js,mjs}.
 * Returns default config if no config file found.
 */
export async function loadConfig(projectRoot: string, configFile?: string): Promise<ConfigResult> {
  if (configFile) {
    const resolved = path.resolve(configFile)
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`)
    }
    return loadConfigFile(resolved)
  }

  for (const filename of CONFIG_FILENAMES) {
    const configPath = path.resolve(projectRoot, filename)
    if (!fs.existsSync(configPath)) continue
    return loadConfigFile(configPath)
  }

  return { config: { dialect: 'postgres' } as ProjectConfig, configPath: null }
}
