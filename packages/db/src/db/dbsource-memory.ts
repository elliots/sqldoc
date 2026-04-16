/**
 * In-memory DbSource: each open() creates a fresh adapter via the plugin system.
 * Used for pglite and sqlite (:memory:), where creating a new instance is cheap.
 */

import type { DbSource } from '@sqldoc/inspector'
import type { ResolvePluginOptions } from './plugin-resolver.ts'
import { resolveAdapterPlugin } from './plugin-resolver.ts'
import type { AdapterPluginContext, DatabaseAdapterPlugin } from './types.ts'

export interface MemoryDbSourceOptions {
  devUrl: string
  context: AdapterPluginContext
  adapterPlugin?: DatabaseAdapterPlugin
  sqldocDir?: ResolvePluginOptions['sqldocDir']
  onMissingPlugin?: ResolvePluginOptions['onMissingPlugin']
}

export function createMemoryDbSource(opts: MemoryDbSourceOptions): DbSource {
  return {
    async open() {
      return resolveAdapterPlugin({
        devUrl: opts.devUrl,
        context: opts.context,
        adapterPlugin: opts.adapterPlugin,
        sqldocDir: opts.sqldocDir,
        onMissingPlugin: opts.onMissingPlugin,
      })
    },
    async close() {},
  }
}
