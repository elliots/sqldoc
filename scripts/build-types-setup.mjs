#!/usr/bin/env node
/**
 * One-shot migration: wire every public @sqldoc/* package to emit .d.ts
 * files into dist/types/ and point their types entry at the .d.ts.
 *
 * For each non-private package with a src/ dir:
 * - Creates tsconfig.json (if missing) extending the root base.
 * - Creates tsconfig.build.json that emits declaration-only output.
 * - Updates package.json exports/types/files/scripts.
 *
 * Idempotent. Safe to re-run. Run this once; commit the result.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = resolve(ROOT, 'packages')

const BUILD_TSCONFIG = {
  extends: './tsconfig.json',
  compilerOptions: {
    noEmit: false,
    emitDeclarationOnly: true,
    declaration: true,
    declarationMap: true,
    outDir: './dist/types',
    rootDir: './src',
  },
  include: ['src'],
  exclude: ['src/__tests__', 'src/**/__tests__', 'src/**/test', 'src/**/*.test.ts'],
}

const MINIMAL_TSCONFIG = {
  extends: '../../tsconfig.base.json',
  compilerOptions: {
    noEmit: true,
  },
  include: ['src'],
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

/** Map a .ts source path under ./src/ to the compiled .d.ts under dist/types/. */
function srcToDts(srcPath) {
  return srcPath.replace(/^\.\/src\/(.+)\.ts$/, './dist/types/$1.d.ts')
}

/**
 * Normalise one export entry so it always exposes a `types` condition
 * pointing at the compiled .d.ts. An entry is the RHS of a subpath key
 * like `"."` or `"./test"` — either a string (shortcut form) or an object
 * of conditions. We don't recurse into the condition values themselves.
 */
function normaliseEntry(entry) {
  if (typeof entry === 'string' && entry.startsWith('./src/')) {
    return { types: srcToDts(entry), import: entry, default: entry }
  }
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const out = { ...entry }
    // Normalise existing `types` condition if it's still pointing at .ts source.
    if (typeof out.types === 'string' && out.types.startsWith('./src/')) {
      out.types = srcToDts(out.types)
    } else if (!('types' in out)) {
      // Infer from import/default if no explicit types condition existed.
      const src = typeof out.import === 'string' ? out.import : typeof out.default === 'string' ? out.default : null
      if (src && src.startsWith('./src/')) out.types = srcToDts(src)
    }
    return out
  }
  return entry
}

function rewriteExportsTypes(exportsBlock) {
  if (!exportsBlock || typeof exportsBlock !== 'object') return exportsBlock
  const out = {}
  for (const [key, value] of Object.entries(exportsBlock)) {
    out[key] = normaliseEntry(value)
  }
  return out
}

function processPackage(pkgDir) {
  const pkgPath = resolve(pkgDir, 'package.json')
  if (!existsSync(pkgPath)) return { skipped: 'no package.json' }

  const pkg = readJson(pkgPath)
  if (pkg.private === true) return { skipped: 'private' }
  if (!existsSync(resolve(pkgDir, 'src'))) return { skipped: 'no src/' }

  // Ensure tsconfig.json exists (needed as base for tsconfig.build.json).
  const tsconfigPath = resolve(pkgDir, 'tsconfig.json')
  if (!existsSync(tsconfigPath)) {
    writeJson(tsconfigPath, MINIMAL_TSCONFIG)
  }

  // Always rewrite tsconfig.build.json — canonical form.
  writeJson(resolve(pkgDir, 'tsconfig.build.json'), BUILD_TSCONFIG)

  // package.json edits.
  let changed = false

  if (pkg.exports) {
    const next = rewriteExportsTypes(pkg.exports)
    if (JSON.stringify(next) !== JSON.stringify(pkg.exports)) {
      pkg.exports = next
      changed = true
    }
  }

  if (typeof pkg.types === 'string' && pkg.types.startsWith('./src/')) {
    pkg.types = pkg.types.replace(/^\.\/src\/(.+)\.ts$/, './dist/types/$1.d.ts')
    changed = true
  }

  if (Array.isArray(pkg.files) && !pkg.files.includes('dist')) {
    // Insert after "src" so ordering reads naturally.
    const idx = pkg.files.indexOf('src')
    if (idx === -1) pkg.files.push('dist')
    else pkg.files.splice(idx + 1, 0, 'dist')
    changed = true
  }

  pkg.scripts ??= {}
  if (pkg.scripts['build:types'] !== 'tsgo -p tsconfig.build.json') {
    pkg.scripts['build:types'] = 'tsgo -p tsconfig.build.json'
    changed = true
  }

  // Each package's build:types invokes `tsgo`, which bun resolves via the
  // package's own node_modules/.bin. Without a local devDep, it falls back
  // to whatever tsgo happens to be on PATH (older dev builds silently emit
  // .js instead of .d.ts — observed with 7.0.0-dev.20260308.1). Pin to the
  // same catalog version every other package uses.
  pkg.devDependencies ??= {}
  if (pkg.devDependencies['@typescript/native-preview'] !== 'catalog:') {
    pkg.devDependencies['@typescript/native-preview'] = 'catalog:'
    changed = true
  }

  if (changed) writeJson(pkgPath, pkg)

  return { done: pkg.name, changed }
}

const results = []
for (const entry of readdirSync(PACKAGES)) {
  const pkgDir = resolve(PACKAGES, entry)
  if (!statSync(pkgDir).isDirectory()) continue
  results.push({ pkg: entry, ...processPackage(pkgDir) })
}

for (const r of results) {
  if (r.skipped) console.log(`skip  ${r.pkg} (${r.skipped})`)
  else console.log(`ok    ${r.pkg}${r.changed ? ' (updated)' : ''}`)
}
