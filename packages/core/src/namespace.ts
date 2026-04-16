import type {
  LintRule,
  LintSeverity,
  NamespaceExample,
  NamespacePlugin,
  NamespaceTagHandler,
  NamespaceTagHandlers,
} from './compiler/types.ts'
import type { DatabaseEngine } from './dialects.ts'
import { dialectForEngine } from './dialects.ts'
import type { ValidationContext } from './types.ts'

export interface NamespaceDefinition extends Omit<NamespacePlugin, 'apiVersion' | 'onTag'> {
  handlers?: NamespaceTagHandlers
  onTag?: NamespacePlugin['onTag']
}

function isSelfTag(tag: string | null): boolean {
  return tag === null || tag === '$self'
}

function normalizeExample(example: NamespaceExample): NamespaceExample {
  const engine = example.engine ?? example.dialect
  const dialect = example.dialect ?? (engine ? dialectForEngine(engine) : undefined)
  return { ...example, engine, dialect }
}

export function defineNamespace<const T extends NamespaceDefinition>(def: T): NamespacePlugin {
  const handlers = def.handlers
  const plugin: NamespacePlugin = {
    apiVersion: 1,
    ...def,
    onTag:
      def.onTag ??
      (handlers
        ? (ctx) => {
            const handler = handlers[ctx.tag.name ?? '$self'] as NamespaceTagHandler | undefined
            return handler?.(ctx)
          }
        : undefined),
  }

  if (!plugin.databases && plugin.engines?.length) {
    plugin.databases = [...new Set(plugin.engines.map((engine) => dialectForEngine(engine)))]
  }

  if (plugin.examples?.length) {
    plugin.examples = plugin.examples.map(normalizeExample)
  }

  return plugin
}

export function requireNamespaceOnSameObject(namespace: string, message: string) {
  return (ctx: ValidationContext): string | undefined => {
    const hasSelf = ctx.siblingTags.some((tag) => tag.namespace === namespace && isSelfTag(tag.tag))
    if (!hasSelf) return message
    return undefined
  }
}

export function requireNamespaceOnSameTable(namespace: string, message: string) {
  return (ctx: ValidationContext): string | undefined => {
    const objectName = ctx.objectName?.toLowerCase()
    if (!objectName) return message

    const hasSelf = ctx.fileTags.some(
      (entry) =>
        entry.objectName.toLowerCase() === objectName &&
        entry.target === 'table' &&
        entry.tags.some((tag) => tag.namespace === namespace && isSelfTag(tag.tag)),
    )

    if (!hasSelf) return message
    return undefined
  }
}

export function createRequireTableTagLintRule(
  namespace: string,
  options: {
    description: string
    default?: LintSeverity
    message?: string | ((objectName: string) => string)
    ruleName?: string
    supportedEngines?: DatabaseEngine[]
  },
): LintRule {
  const message =
    options.message ??
    ((objectName: string) => {
      return `Table '${objectName}' has no @${namespace} tag`
    })

  return {
    name: options.ruleName ?? `${namespace}.require-${namespace}`,
    description: options.description,
    default: options.default ?? 'warn',
    check(ctx) {
      const diagnostics = []
      for (const output of ctx.outputs) {
        const tableObjects = output.fileTags.filter((obj) => obj.target === 'table')

        for (const obj of tableObjects) {
          if (options.supportedEngines && !options.supportedEngines.includes(ctx.config.engine)) continue

          const hasSelf = obj.tags.some((tag) => tag.namespace === namespace && isSelfTag(tag.tag))
          if (hasSelf) continue

          diagnostics.push({
            objectName: obj.objectName,
            sourceFile: output.sourceFile,
            message: typeof message === 'function' ? message(obj.objectName) : message,
          })
        }
      }

      return diagnostics
    },
  }
}
