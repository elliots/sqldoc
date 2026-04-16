import { defineNamespace, type ProjectContext, type ProjectOutput, type Realm } from '@sqldoc/core'
import { mergeSchemaWithTags } from './merge.ts'
import { generateMermaidERD } from './mermaid.ts'
import { renderHtml } from './renderers/html.ts'
import { renderMarkdown } from './renderers/markdown.ts'
import type { DocsConfig } from './types.ts'

const plugin = defineNamespace({
  name: 'docs',
  description: 'Schema documentation metadata plus project-level HTML/Markdown rendering',
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
  examples: [
    {
      title: 'Generate schema docs',
      description: 'The namespace contributes metadata in SQL and renders files at project compile time.',
      input: `-- @docs.description('Central inventory of all products')
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);`,
    },
  ],
  async afterCompile(ctx: ProjectContext): Promise<ProjectOutput> {
    const config = ctx.config as Partial<DocsConfig> | undefined
    if (!config) return { files: [] }
    if (!config.output) {
      throw new Error('ns-docs config requires "output" (file path, e.g. "docs/schema.html")')
    }
    if (!config.format) {
      throw new Error('ns-docs config requires "format" ("markdown" or "html")')
    }

    const { format, output: outputPath } = config
    const title = config.title ?? 'Schema Documentation'
    const realm: Realm | undefined = ctx.schemaRealm
    if (!realm) {
      throw new Error('ns-docs requires inspected schema. Run with a database connection (devUrl in config).')
    }

    const mermaid = generateMermaidERD(realm)
    const merged = mergeSchemaWithTags(realm, mermaid, ctx.allFileTags, ctx.outputs, title, ctx.docsMeta)
    const content = format === 'html' ? renderHtml(merged) : renderMarkdown(merged)

    return {
      files: [{ filePath: outputPath, content }],
    }
  },
})

export default plugin
export type { DocsConfig }
