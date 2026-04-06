/**
 * Worker entry point wrapper that enables TypeScript type stripping
 * for .ts files under node_modules/ before loading worker.ts.
 *
 * Node's built-in type stripping skips node_modules, so we register
 * a custom ESM loader that uses Node's stripTypeScriptTypes API.
 */
import { register } from 'node:module'

process.removeAllListeners('warning')

const loaderCode = [
  'import { stripTypeScriptTypes } from "node:module";',
  'export async function load(url, context, nextLoad) {',
  '  if (url.endsWith(".ts") && url.includes("node_modules")) {',
  '    const result = await nextLoad(url, { ...context, format: "module" });',
  '    const source = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);',
  '    const stripped = stripTypeScriptTypes(source, { mode: "strip" });',
  '    return { format: "module", source: stripped, shortCircuit: true };',
  '  }',
  '  return nextLoad(url, context);',
  '}',
].join('\n')

register(`data:text/javascript,${encodeURIComponent(loaderCode)}`)

await import('./worker.ts')
