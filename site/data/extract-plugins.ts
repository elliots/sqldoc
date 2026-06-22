import * as path from 'node:path'
import anon from '../../packages/ns-anon/src/index.ts'
import audit from '../../packages/ns-audit/src/index.ts'
import codegen from '../../packages/ns-codegen/src/index.ts'
import comment from '../../packages/ns-comment/src/index.ts'
import deprecated from '../../packages/ns-deprecated/src/index.ts'
import docs from '../../packages/ns-docs/src/index.ts'
import history from '../../packages/ns-history/src/index.ts'
import lint from '../../packages/ns-lint/src/index.ts'
import postgraphile from '../../packages/ns-postgraphile/src/index.ts'
import rls from '../../packages/ns-rls/src/index.ts'
import softdelete from '../../packages/ns-softdelete/src/index.ts'
import temporal from '../../packages/ns-temporal/src/index.ts'
import validate from '../../packages/ns-validate/src/index.ts'

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

const namespaceModules: Record<string, RuntimePlugin> = {
  '../../packages/ns-anon/src/index.ts': anon,
  '../../packages/ns-audit/src/index.ts': audit,
  '../../packages/ns-codegen/src/index.ts': codegen,
  '../../packages/ns-comment/src/index.ts': comment,
  '../../packages/ns-deprecated/src/index.ts': deprecated,
  '../../packages/ns-docs/src/index.ts': docs,
  '../../packages/ns-history/src/index.ts': history,
  '../../packages/ns-lint/src/index.ts': lint,
  '../../packages/ns-postgraphile/src/index.ts': postgraphile,
  '../../packages/ns-rls/src/index.ts': rls,
  '../../packages/ns-softdelete/src/index.ts': softdelete,
  '../../packages/ns-temporal/src/index.ts': temporal,
  '../../packages/ns-validate/src/index.ts': validate,
}

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
    .map(([sourceFile, plugin]) => pluginMetaFromModule(sourceFile, plugin))

  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return plugins
}
