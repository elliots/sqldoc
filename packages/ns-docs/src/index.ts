import type { NamespacePlugin, ProjectContext, ProjectOutput, Realm } from '@sqldoc/core'
import { mergeSchemaWithTags } from './merge.ts'
import { generateMermaidERD } from './mermaid.ts'
import { renderHtml } from './renderers/html.ts'
import { renderMarkdown } from './renderers/markdown.ts'
import type { DocsConfig } from './types.ts'

const plugin: NamespacePlugin = {
  apiVersion: 1,
  name: 'docs',
  tags: {
    emit: {
      description: 'Include or exclude this object from documentation',
      targets: ['table', 'view', 'function', 'type'],
      args: [{ type: 'boolean' }],
    },
    description: {
      description: 'Set custom description text for this object in documentation',
      targets: ['table', 'column', 'view', 'function', 'type'],
      args: [{ type: 'string' }],
    },
    previously: {
      description: 'Indicate this object was renamed from a previous name',
      targets: ['table', 'column'],
      args: [{ type: 'string' }],
    },
  },

  async afterCompile(ctx: ProjectContext): Promise<ProjectOutput> {
    const config = ctx.config as Partial<DocsConfig> | undefined
    if (!config) {
      return { files: [] }
    }
    if (!config.output) {
      throw new Error('ns-docs config requires "output" (file path, e.g. "docs/schema.html")')
    }
    if (!config.format) {
      throw new Error('ns-docs config requires "format" ("markdown" or "html")')
    }
    const { format, output: outputPath } = config
    const title = config.title ?? 'Schema Documentation'

    // The inspected schema realm is provided by CLI compile
    const realm: Realm | undefined = ctx.schemaRealm
    if (!realm) {
      throw new Error('ns-docs requires inspected schema. Run with a database connection (devUrl in config).')
    }

    const mermaid = generateMermaidERD(realm)

    // Merge schema with sqldoc tags
    const merged = mergeSchemaWithTags(realm, mermaid, ctx.allFileTags, ctx.outputs, title, ctx.docsMeta)

    // Render to chosen format
    const content = format === 'html' ? renderHtml(merged) : renderMarkdown(merged)

    return {
      files: [{ filePath: outputPath, content }],
    }
  },
}

export default plugin
export type { DocsConfig }
