import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findSqldocDir, loadConfig } from '@sqldoc/core'
import pc from 'picocolors'

const CHECK = pc.green('\u2713')
const CROSS = pc.red('\u2717')

interface CheckResult {
  label: string
  ok: boolean
  detail?: string
}

/**
 * sqldoc doctor: checks the project setup and reports status.
 */
export async function doctorCommand(): Promise<void> {
  const projectRoot = process.env.SQLDOC_PROJECT_ROOT || process.cwd()
  const results: CheckResult[] = []

  // 1. .sqldoc/ directory exists
  const sqldocDir = findSqldocDir(projectRoot)
  results.push({
    label: '.sqldoc/ directory exists',
    ok: sqldocDir !== null,
    detail: sqldocDir || 'Not found. Run: sqldoc init',
  })

  // 2. package.json has @sqldoc/cli dependency
  let hasPkgJson = false
  let hasCliDep = false
  if (sqldocDir) {
    const pkgJsonPath = path.join(sqldocDir, 'package.json')
    if (fs.existsSync(pkgJsonPath)) {
      hasPkgJson = true
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }
        hasCliDep = '@sqldoc/cli' in deps
      } catch {}
    }
  }
  results.push({
    label: 'package.json has @sqldoc/cli dependency',
    ok: hasCliDep,
    detail: sqldocDir
      ? hasPkgJson
        ? hasCliDep
          ? undefined
          : '@sqldoc/cli not listed in dependencies'
        : 'No package.json in .sqldoc/'
      : 'No .sqldoc/ directory',
  })

  // 3. node_modules exists and has @sqldoc/cli
  let hasNodeModules = false
  let hasCliInstalled = false
  if (sqldocDir) {
    const nmDir = path.join(sqldocDir, 'node_modules')
    hasNodeModules = fs.existsSync(nmDir)
    if (hasNodeModules) {
      hasCliInstalled = fs.existsSync(path.join(nmDir, '@sqldoc', 'cli'))
    }
  }
  results.push({
    label: 'node_modules/ has @sqldoc/cli installed',
    ok: hasCliInstalled,
    detail: sqldocDir
      ? hasNodeModules
        ? hasCliInstalled
          ? undefined
          : '@sqldoc/cli not found in node_modules/'
        : 'node_modules/ missing. Run install in .sqldoc/'
      : 'No .sqldoc/ directory',
  })

  // 4. atlas.wasm is findable
  let wasmFound = false
  let wasmPath: string | undefined
  if (process.env.ATLAS_WASM_PATH && fs.existsSync(process.env.ATLAS_WASM_PATH)) {
    wasmFound = true
    wasmPath = process.env.ATLAS_WASM_PATH
  } else {
    // Walk up from current file's directory looking for atlas.wasm (same logic as @sqldoc/db)
    let dir = path.dirname(fileURLToPath(import.meta.url))
    const searched: string[] = []
    outer: while (true) {
      for (const candidate of [
        path.join(dir, 'wasm', 'atlas.wasm'),
        path.join(dir, '..', 'wasm', 'atlas.wasm'),
        path.join(dir, 'node_modules', '@sqldoc', 'db', 'wasm', 'atlas.wasm'),
        path.join(dir, 'packages', 'db', 'wasm', 'atlas.wasm'),
      ]) {
        searched.push(candidate)
        if (fs.existsSync(candidate)) {
          wasmFound = true
          wasmPath = candidate
          break outer
        }
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  results.push({
    label: 'atlas.wasm is findable',
    ok: wasmFound,
    detail: wasmFound ? wasmPath : 'atlas.wasm not found. Set ATLAS_WASM_PATH or check installation.',
  })

  // 6. Config file exists and is parseable
  let configOk = false
  let configDetail: string | undefined
  try {
    const { configPath } = await loadConfig(projectRoot)
    if (configPath) {
      configOk = true
      configDetail = path.relative(projectRoot, configPath)
    } else {
      // No config file found — this is acceptable (defaults used)
      configOk = true
      configDetail = 'No config file found (using defaults)'
    }
  } catch (err: any) {
    configDetail = err?.message ?? String(err)
  }
  results.push({
    label: 'Config file is parseable',
    ok: configOk,
    detail: configDetail,
  })

  // Print results
  console.error('')
  console.error(pc.bold('sqldoc doctor'))
  console.error('')
  let allOk = true
  for (const r of results) {
    const icon = r.ok ? CHECK : CROSS
    console.error(`  ${icon} ${r.label}`)
    if (r.detail && !r.ok) {
      console.error(`    ${pc.dim(r.detail)}`)
    }
    if (!r.ok) allOk = false
  }
  console.error('')

  if (allOk) {
    console.error(pc.green('All checks passed!'))
  } else {
    console.error(pc.yellow('Some checks failed. See details above.'))
    process.exitCode = 1
  }
}
