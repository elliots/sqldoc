// Preload module — registers an ESM loader that strips TypeScript types
// from ALL .ts files, including those under node_modules (which Node 24
// refuses to handle natively). Loaded via: node --import ./register-loader.mjs

import { register } from 'node:module'

const loaderCode = [
  'import { stripTypeScriptTypes } from "node:module";',
  'export async function load(url, context, nextLoad) {',
  '  if (url.endsWith(".ts")) {',
  '    const result = await nextLoad(url, context);',
  '    const source = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);',
  '    return { format: "module", source: stripTypeScriptTypes(source, { mode: "strip" }), shortCircuit: true };',
  '  }',
  '  return nextLoad(url, context);',
  '}',
].join('\n')

register(`data:text/javascript,${encodeURIComponent(loaderCode)}`)
