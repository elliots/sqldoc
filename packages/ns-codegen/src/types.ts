import type { ArgType, DocsMeta, InferSchema } from '@sqldoc/core'
import type { Realm } from '@sqldoc/db'

/** Config for the codegen namespace in sqldoc.config.ts namespaces.codegen */
export interface CodegenConfig {
  templates?: TemplateEntry[]
  /** When true, strip schema prefixes from generated type names. Hard error on name clashes. */
  stripSchemaFromName?: boolean
}

export interface CodegenNamespaceConfig {
  codegen: CodegenConfig
}

/** A single template entry in the codegen config */
export interface TemplateEntry {
  /** The template — either an import path string or a Template object */
  template: string | Template<any>
  /** Output path — file path for single-file templates, directory for multi-file templates */
  output: string
  /** Template-specific config (typed by each template) */
  config?: Record<string, unknown>
}

/** Context passed to each template's generate function */
export interface TemplateContext<C = Record<string, unknown>> {
  /** Full post-compile schema realm */
  realm: Realm
  /** All tags across all files, grouped by source file then by SQL object */
  allFileTags: Array<{
    sourceFile: string
    objects: Array<{
      objectName: string
      target: string
      tags: Array<{ namespace: string; tag: string | null; args: Record<string, unknown> | unknown[] }>
    }>
  }>
  /** Aggregated docs metadata from all plugins */
  docsMeta: DocsMeta[]
  /** Template-specific config from sqldoc.config.ts */
  config: C
  /** Output directory path */
  output: string
  /** Template name (derived from import path) */
  templateName: string
  /** Set of object names from @external files. Templates can use this to annotate external types. */
  externalObjectNames?: Set<string>
  /** When true, strip schema prefixes from generated type names. Propagated from CodegenConfig. */
  stripSchemaFromName?: boolean
  /** Default schema for the dialect (e.g. 'public' for postgres). Tables in this schema don't get schema-prefixed names. */
  defaultSchema?: string
}

/** Result returned from a template's generate function */
export interface TemplateResult {
  files: Array<{ path: string; content: string }>
}

/** Template definition (the object shape) */
export interface TemplateDef<S extends Record<string, ArgType> = Record<string, ArgType>> {
  /** Human-readable template name */
  name: string
  /** What this template generates */
  description: string
  /** Target language/format */
  language: string
  /** Config schema using ArgType definitions — use `as const` for type inference */
  configSchema?: S
  /** Generate output files from the schema + tags */
  generate: (ctx: TemplateContext<InferSchema<S>>) => TemplateResult
}

/** A template is callable (creates a typed TemplateEntry) and has metadata properties */
export interface Template<S extends Record<string, ArgType> = Record<string, ArgType>> extends TemplateDef<S> {
  (opts: { output: string } & InferSchema<S>): TemplateEntry
}

/**
 * Helper to define a template with full type inference.
 * Returns a callable: `typescript({ output: '...', dateType: 'temporal' })`
 */
export function defineTemplate<const S extends Record<string, ArgType>>(def: TemplateDef<S>): Template<S> {
  const fn = function (this: void, opts: { output: string } & InferSchema<S>): TemplateEntry {
    const { output, ...config } = opts
    return {
      template: fn as any,
      output,
      config: Object.keys(config).length > 0 ? (config as Record<string, unknown>) : undefined,
    }
  }
  // 'name' is read-only on functions — use defineProperty
  Object.defineProperty(fn, 'name', { value: def.name, writable: false })
  Object.assign(fn, {
    description: def.description,
    language: def.language,
    configSchema: def.configSchema,
    generate: def.generate,
  })
  return fn as unknown as Template<S>
}
