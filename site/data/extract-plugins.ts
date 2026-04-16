import * as path from 'node:path'

export interface ArgMeta {
  name: string
  type: string
  required?: boolean
  values?: string[]
}

export interface TagMeta {
  name: string
  description: string
  targets: string[]
  args: ArgMeta[] | 'none'
}

export interface LintRuleMeta {
  name: string
  description: string
  default: string
}

export interface ExampleMeta {
  title: string
  description?: string
  engine?: string
  dialect?: string
  input: string
  output?: string
}

export interface PluginMeta {
  name: string
  dirName: string
  description: string
  databases: string[]
  tags: TagMeta[]
  lintRules: LintRuleMeta[]
  examples: ExampleMeta[]
  sourceFile: string
}

interface RuntimeArg {
  type: string
  required?: boolean
  values?: string[]
  items?: RuntimeArg
}

interface RuntimeTagDef {
  description?: string
  targets?: string[]
  args?: RuntimeArg[] | Record<string, RuntimeArg>
}

interface RuntimeLintRule {
  name: string
  description: string
  default: string
}

interface RuntimeExample {
  title: string
  description?: string
  engine?: string
  dialect?: string
  input: string
  output?: string
}

interface RuntimePlugin {
  name: string
  description?: string
  databases?: string[]
  tags: Record<string, RuntimeTagDef>
  lintRules?: RuntimeLintRule[]
  examples?: RuntimeExample[]
}

const namespaceModules = import.meta.glob('../../packages/ns-*/src/index.ts', {
  eager: true,
}) as Record<string, { default?: RuntimePlugin }>

function toArgMeta(name: string, arg: RuntimeArg): ArgMeta {
  return {
    name,
    type: arg.type,
    required: arg.required,
    values: arg.type === 'enum' ? arg.values : arg.type === 'array' && arg.items?.type === 'enum' ? arg.items.values : undefined,
  }
}

function toTagMeta(name: string, tag: RuntimeTagDef): TagMeta {
  if (!tag.args) {
    return {
      name,
      description: tag.description ?? '',
      targets: tag.targets ?? [],
      args: 'none',
    }
  }

  if (Array.isArray(tag.args)) {
    return {
      name,
      description: tag.description ?? '',
      targets: tag.targets ?? [],
      args: tag.args.length > 0 ? tag.args.map((arg, index) => toArgMeta(`arg${index}`, arg)) : 'none',
    }
  }

  const args = Object.entries(tag.args).map(([argName, arg]) => toArgMeta(argName, arg))
  return {
    name,
    description: tag.description ?? '',
    targets: tag.targets ?? [],
    args: args.length > 0 ? args : 'none',
  }
}

function pluginMetaFromModule(sourceFile: string, plugin: RuntimePlugin): PluginMeta {
  return {
    name: plugin.name,
    dirName: path.basename(path.dirname(path.dirname(sourceFile))).replace(/^ns-/, ''),
    description: plugin.description ?? '',
    databases: plugin.databases ?? ['postgres', 'mysql', 'sqlite', 'mssql'],
    tags: Object.entries(plugin.tags ?? {}).map(([name, tag]) => toTagMeta(name, tag)),
    lintRules: (plugin.lintRules ?? []).map((rule) => ({
      name: rule.name,
      description: rule.description,
      default: rule.default,
    })),
    examples: (plugin.examples ?? []).map((example) => ({ ...example })),
    sourceFile,
  }
}

export function extractAllPlugins(): PluginMeta[] {
  const plugins = Object.entries(namespaceModules)
    .map(([sourceFile, mod]) => {
      const plugin = mod.default
      if (!plugin) return null
      return pluginMetaFromModule(sourceFile, plugin)
    })
    .filter((plugin): plugin is PluginMeta => plugin !== null)

  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return plugins
}
