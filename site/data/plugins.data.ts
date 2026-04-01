import { extractAllPlugins, type PluginMeta } from './extract-plugins'

declare const data: PluginMeta[]
export { data }

export default {
  load(): PluginMeta[] {
    return extractAllPlugins()
  },
}
