import { cpSync, existsSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url))

import { glob } from "node:fs/promises";

async function findFile(rootDir, fileName) {
  const { value, done } = await glob(`**/${fileName}`, {
    cwd: rootDir,
    absolute: true,
    followSymlinks: true,
  }).next();

  return done ? undefined : resolve(rootDir, value);
}


// Copy sqlparser WASM to out/
cpSync(
  await findFile(`${__dirname}/node_modules`, 'sqlparser_rs_wasm_bg.wasm'),
  resolve(__dirname, 'out/sqlparser_rs_wasm_bg.wasm'),
)

// Copy libpg-query WASM to out/
cpSync(
  require.resolve(
    "libpg-query/wasm/libpg-query.wasm",
  ),
  resolve(__dirname, 'out/libpg-query.wasm'),
)

// Copy esbuild-wasm into out/node_modules/ so it ships in the VSIX
// (esbuild's JS API needs its wasm binary at a relative path it controls)
const esbuildWasmDest = resolve(__dirname, 'out/node_modules/esbuild-wasm')
if (existsSync(esbuildWasmDest)) rmSync(esbuildWasmDest, { recursive: true })
cpSync(dirname(await findFile(`${__dirname}/node_modules`, 'esbuild.wasm')), esbuildWasmDest, {
  recursive: true,
  dereference: true
})

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode', 'esbuild-wasm'],
  alias: { esbuild: 'esbuild-wasm' },
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  // Shim import.meta.url for CJS (WASM loader uses new URL('file.wasm', import.meta.url))
  banner: {
    js: 'var import_meta_url = require("url").pathToFileURL(__filename).href;',
  },
  define: {
    'import.meta.url': 'import_meta_url',
  },
})

// Fix WASM paths in bundled code to point to out/ directory
const outFile = resolve(__dirname, 'out/extension.js')
let code = readFileSync(outFile, 'utf-8')
code = code.replaceAll('../wasm/sqlparser_rs_wasm_bg.wasm', './sqlparser_rs_wasm_bg.wasm')
writeFileSync(outFile, code)
