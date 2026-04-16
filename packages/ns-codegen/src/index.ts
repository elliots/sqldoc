import * as path from 'node:path'
import {
  defineNamespace,
  findSqldocDir,
  type ProjectContext,
  type ProjectOutput,
  type Realm,
  tsImport,
  unwrapDefault,
} from '@sqldoc/core'
import type { CodegenConfig, TemplateContext } from './types.ts'

function extractTemplateName(importPath: string): string {
  const parts = importPath.split('/')
  const last = parts[parts.length - 1]
  return last.replace(/\.[^.]+$/, '')
}

const plugin = defineNamespace({
  name: 'codegen',
  description: 'Project-level template execution for generated code and typed artifacts',
  tags: {
    rename: {
      description: 'Rename table/column in generated code (optional second arg scopes to a specific template)',
      targets: ['table', 'column', 'view'],
      args: [{ type: 'string' }, { type: 'string' }],
    },
    skip: {
      description: 'Exclude from generated code (optional arg scopes to a specific template)',
      targets: ['table', 'column', 'view'],
      args: [{ type: 'string' }],
    },
    type: {
      description: 'Override generated type for a column (optional second arg scopes to a specific template)',
      targets: ['column'],
      args: [{ type: 'string' }, { type: 'string' }],
    },
  },
  examples: [
    {
      title: 'Shape generated code',
      description: 'These tags affect template output rather than emitted SQL.',
      input: `-- @codegen.rename('ProductItem')
CREATE TABLE products (
  -- @codegen.type('Money')
  price NUMERIC(10,2),
  -- @codegen.skip
  internal_notes TEXT
);`,
    },
  ],
  async afterCompile(ctx: ProjectContext): Promise<ProjectOutput> {
    const config = ctx.config as CodegenConfig
    if (!config.templates || config.templates.length === 0) {
      return { files: [] }
    }

    const realm: Realm | undefined = ctx.schemaRealm
    if (!realm) {
      throw new Error('ns-codegen requires inspected schema. Run with a database connection (devUrl in config).')
    }

    const allFiles: Array<{ filePath: string; content: string; source: string }> = []

    for (const entry of config.templates) {
      let template: any

      if (typeof entry.template === 'function' && typeof entry.template.generate === 'function') {
        template = entry.template
      } else if (typeof entry.template === 'string') {
        const isAbsolute = path.isAbsolute(entry.template) || entry.template.startsWith('.')
        let mod: any
        if (isAbsolute) {
          mod = await import(entry.template)
        } else {
          let resolveDir: string | null = null
          if (process.env.SQLDOC_RESOLVE_FROM_LOCAL_PACKAGE === 'true') {
            resolveDir = ctx.projectRoot
          } else {
            const sqldocDir = findSqldocDir(ctx.projectRoot)
            resolveDir = sqldocDir ? path.join(sqldocDir, 'node_modules') : null
          }
          if (!resolveDir) {
            throw new Error(
              `Cannot resolve template '${entry.template}': no .sqldoc/node_modules/ found. Run 'sqldoc init' first.`,
            )
          }
          mod = (await tsImport(entry.template, resolveDir)) as any
        }
        template = unwrapDefault(mod, (m: any) => typeof m.generate === 'function')
      }

      if (!template || typeof template.generate !== 'function') {
        throw new Error(`Template '${entry.template}' does not export a generate function`)
      }

      const templateName =
        typeof entry.template === 'string' ? extractTemplateName(entry.template) : (template.name ?? 'unknown')
      const defaultSchema = realm.defaultSchema

      const templateCtx: TemplateContext = {
        engine: ctx.engine,
        dialect: ctx.dialect,
        realm,
        allFileTags: ctx.allFileTags,
        docsMeta: ctx.docsMeta,
        config: entry.config ?? {},
        output: entry.output,
        templateName,
        externalObjectNames: ctx.externalObjectNames,
        stripSchemaFromName: config.stripSchemaFromName,
        defaultSchema,
      }

      const result = template.generate(templateCtx)
      const outputIsFile = path.extname(entry.output) !== ''

      if (outputIsFile && result.files.length > 1) {
        throw new Error(
          `Template '${templateName}' generates ${result.files.length} files but output '${entry.output}' is a file path. Use a directory instead.`,
        )
      }

      for (const file of result.files) {
        const filePath = outputIsFile ? entry.output : path.join(entry.output, file.path)
        allFiles.push({ filePath, content: file.content, source: templateName })
      }
    }

    return { files: allFiles }
  },
})

export default plugin
export type {
  CodegenConfig,
  CodegenNamespaceConfig,
  Template,
  TemplateContext,
  TemplateDef,
  TemplateEntry,
  TemplateResult,
} from './types.ts'
export { defineTemplate } from './types.ts'
