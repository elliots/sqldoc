import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Copy sqlparser WASM to out/
cpSync(
  resolve(__dirname, '../sqlparser-ts/wasm/sqlparser_rs_wasm_bg.wasm'),
  resolve(__dirname, 'out/sqlparser_rs_wasm_bg.wasm'),
)

// Copy esbuild-wasm into out/node_modules/ so it ships in the VSIX
// (esbuild's JS API needs its wasm binary at a relative path it controls)
const esbuildWasmDest = resolve(__dirname, 'out/node_modules/esbuild-wasm')
if (existsSync(esbuildWasmDest)) rmSync(esbuildWasmDest, { recursive: true })
cpSync(resolve(__dirname, '../node_modules/.pnpm/esbuild-wasm@0.27.4/node_modules/esbuild-wasm'), esbuildWasmDest, {
  recursive: true,
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
