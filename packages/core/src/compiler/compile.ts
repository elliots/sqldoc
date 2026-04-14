/**
 * Core compiler pipeline: parse tags, build context, invoke generators.
 *
 * compile() takes pre-parsed inputs (source, plugins, statements, config)
 * and orchestrates generateSQL/generateCode for each tag occurrence.
 *
 * Supports two compilation tiers:
 * - Tier 1 (parser only): Uses block resolution from sqlparser-ts (VSCode, validation)
 * - Tier 2 (schema-aware): Uses inspected schema with tags already matched to objects
 */

import type { SqlAstAdapter } from '../ast/adapter.ts'
import type { SqlCommentOn, SqlStatement } from '../ast/types.ts'
import type { TagBlock } from '../blocks.ts'
import { buildBlocks } from '../blocks.ts'
import { debug } from '../debug.ts'
import { parse, parseArgs } from '../parser.ts'
import type { Attr, Realm, Table, Tag, View } from '../schema.ts'
import type { Dialect } from '../sql-emitter.ts'
import { escapeString, escapeStringWithNewlines } from '../sql-emitter.ts'
import type { SqlTarget } from '../types.ts'
import type {
  CodeOutput,
  CompilerOutput,
  DocsMeta,
  NamespaceConfig,
  NamespacePlugin,
  ResolvedConfig,
  SqlOutput,
  TagContext,
  TagOutput,
} from './types.ts'

// ── Plugin compatibility ─────────────────────────────────────────────

/**
 * Check if a plugin supports the current dialect.
 * Plugins without a databases field are compatible with all dialects.
 */
function isPluginCompatible(plugin: NamespacePlugin, dialect: Dialect): boolean {
  if (!plugin.databases) return true
  return plugin.databases.includes(dialect)
}

// ── Public API ───────────────────────────────────────────────────────

export interface CompileOptions {
  /** SQL file content */
  source: string
  /** SQL file path (for import resolution) */
  filePath: string
  /** Loaded namespace plugins (already resolved, keyed by namespace name) */
  plugins: Map<string, NamespacePlugin>
  /** Parsed SQL statements from AST adapter */
  statements: SqlStatement[]
  /** The AST adapter instance (initialized) */
  adapter: SqlAstAdapter
  /** Project config */
  config: ResolvedConfig
  /** Inspected schema realm (Tier 2). When provided, uses schema tag-to-object matching instead of block resolution. */
  schemaRealm?: Realm
}

export function compile(options: CompileOptions): CompilerOutput {
  const { source, filePath, plugins, statements, config, adapter, schemaRealm } = options
  debug(
    'compile',
    `file=${filePath}, tier=${schemaRealm ? 2 : 1}, plugins=[${[...plugins.keys()].join(', ')}], dialect=${config.dialect}`,
  )

  // Tier 2: inspected schema realm provided — use schema tag-to-object matching
  if (schemaRealm) {
    const result = compileWithRealm(schemaRealm, filePath, plugins, statements, config, source, adapter)
    // Merge parser-derived tags that schema inspection doesn't see (e.g. @lint.ignore)
    // These tags have no SQL output so the inspector never encounters them
    const tags = parse(source).tags
    if (tags.length > 0) {
      const docLines = source.split('\n')
      const blocks = buildBlocks(tags, source, docLines, statements)
      const parserFileTags = buildFileTags(blocks)
      mergeParserTags(result.fileTags, parserFileTags)
    }
    return result
  }

  // Tier 1: no schema realm — use block resolution
  return compileTier1(source, filePath, plugins, statements, config, adapter)
}

// ── Tier 1: Block resolution (existing logic) ─────────────────────────

function compileTier1(
  source: string,
  filePath: string,
  plugins: Map<string, NamespacePlugin>,
  statements: SqlStatement[],
  config: ResolvedConfig,
  adapter: SqlAstAdapter,
): CompilerOutput {
  const sqlOutputs: SqlOutput[] = []
  const codeOutputs: CodeOutput[] = []
  const docsMeta: DocsMeta[] = []
  const errors: Array<{ namespace: string; message: string }> = []

  // 1. Parse source to extract tags
  const { tags } = parse(source)
  if (tags.length === 0) {
    debug('compile', `tier1: no tags in ${filePath}`)
    return { sourceFile: filePath, mergedSql: source, sqlOutputs, codeOutputs, errors, docsMeta, fileTags: [] }
  }

  // 2. Build tag blocks (group consecutive comment-line tags, resolve to SQL object)
  const docLines = source.split('\n')
  const blocks = buildBlocks(tags, source, docLines, statements)
  debug('compile', `tier1: ${tags.length} tags -> ${blocks.length} blocks`)

  // 3. Build file-level tag summary (all tags across file grouped by object)
  const fileTags = buildFileTags(blocks)

  // 4. Process each block
  const skippedPlugins = new Set<string>()
  const missingNamespaces = new Set<string>()
  for (const block of blocks) {
    const { objectName, target, columnName, columnType, astNode } = block.ast

    // Group tags by namespace within this block
    for (const tag of block.tags) {
      const plugin = plugins.get(tag.namespace)
      if (!plugin) {
        if (!missingNamespaces.has(tag.namespace)) {
          missingNamespaces.add(tag.namespace)
          errors.push({
            namespace: tag.namespace,
            message: `No plugin loaded for namespace '${tag.namespace}'. Is '@sqldoc/ns-${tag.namespace}' imported?`,
          })
        }
        continue
      }

      // Check plugin compatibility with target dialect
      const dialect = config.dialect
      if (!isPluginCompatible(plugin, dialect)) {
        if (!skippedPlugins.has(plugin.name)) {
          skippedPlugins.add(plugin.name)
          errors.push({
            namespace: plugin.name,
            message: `Skipped: plugin '${plugin.name}' does not support dialect '${dialect}' (supports: ${plugin.databases!.join(', ')})`,
          })
        }
        continue
      }

      const tagHandler = plugin.onTag ?? plugin.generateSQL
      if (!tagHandler && !plugin.generateCode) continue

      // Build namespaceTags: all tags from same namespace on same object
      const namespaceTags = block.tags
        .filter((t) => t.namespace === tag.namespace)
        .map((t) => ({
          tag: t.tag,
          args: parsedArgsToValue(t.rawArgs),
        }))

      // Build siblingTags: all tags from ALL namespaces on same object
      const siblingTags = block.tags.map((t) => ({
        namespace: t.namespace,
        tag: t.tag,
        args: parsedArgsToValue(t.rawArgs),
      }))

      const ctx: TagContext = {
        dialect: config.dialect,
        target,
        objectName: objectName ?? 'unknown',
        columnName,
        columnType,
        tag: {
          name: tag.tag,
          args: parsedArgsToValue(tag.rawArgs),
        },
        namespaceTags,
        siblingTags,
        fileTags,
        astNode: astNode ?? null,
        fileStatements: statements,
        config: (config.namespaces?.[tag.namespace] ?? {}) as NamespaceConfig,
        filePath,
      }

      invokePlugin(plugin, tagHandler, ctx, tag, sqlOutputs, codeOutputs, docsMeta, errors)
    }
  }

  // 5. Build merged SQL: original source + generated SQL appended
  const mergedSql = buildMergedOutput(source, sqlOutputs, adapter, config.dialect)
  debug(
    'compile',
    `tier1: done, ${sqlOutputs.length} sql output(s), ${codeOutputs.length} code output(s), ${errors.length} error(s)`,
  )

  return { sourceFile: filePath, mergedSql, sqlOutputs, codeOutputs, errors, docsMeta, fileTags }
}

// ── Tier 2: schema realm compilation ──────────────────────────────────

function compileWithRealm(
  realm: Realm,
  filePath: string,
  plugins: Map<string, NamespacePlugin>,
  statements: SqlStatement[],
  config: ResolvedConfig,
  source: string,
  adapter: SqlAstAdapter,
): CompilerOutput {
  const sqlOutputs: SqlOutput[] = []
  const codeOutputs: CodeOutput[] = []
  const docsMeta: DocsMeta[] = []
  const errors: Array<{ namespace: string; message: string }> = []

  // Collect all tag occurrences across the realm for fileTags building
  const allTagOccurrences: Array<{
    objectName: string
    target: SqlTarget
    namespace: string
    tag: string | null
    args: Record<string, unknown> | unknown[]
  }> = []

  const tableCount = realm.schemas.reduce((n, s) => n + (s.tables?.length ?? 0), 0)
  const viewCount = realm.schemas.reduce((n, s) => n + (s.views?.length ?? 0), 0)
  debug('compile', `tier2: ${realm.schemas.length} schema(s), ${tableCount} table(s), ${viewCount} view(s)`)

  // Parse source to find which namespaces THIS file uses (not other files in the realm)
  const fileNamespaces = new Set(parse(source).tags.map((t) => t.namespace))

  const skippedPlugins = new Set<string>()
  const missingNamespaces = new Set<string>()
  const actx: RealmObjectContext = {
    realm,
    filePath,
    plugins,
    statements,
    config,
    sqlOutputs,
    codeOutputs,
    docsMeta,
    errors,
    allTagOccurrences,
    skippedPlugins,
    missingNamespaces,
    fileNamespaces,
  }
  // Default schema is set by the inspector on the realm
  const defaultSchema = realm.defaultSchema ?? ''

  for (const schema of realm.schemas) {
    const qualify = (name: string) => (schema.name && schema.name !== defaultSchema ? `${schema.name}.${name}` : name)

    // Process tables
    if (schema.tables) {
      for (const table of schema.tables) {
        processRealmObject(table, 'table', qualify(table.name), actx)
      }
    }

    // Process views
    if (schema.views) {
      for (const view of schema.views) {
        processRealmObject(view, 'view', qualify(view.name), actx)
      }
    }
  }

  // Build fileTags from collected tag occurrences
  const fileTags = buildFileTags2(allTagOccurrences)

  // Build merged SQL output
  const mergedSql = buildMergedOutput(source, sqlOutputs, adapter, config.dialect)

  return { sourceFile: filePath, mergedSql, sqlOutputs, codeOutputs, errors, docsMeta, fileTags }
}

/** Shared context for processRealmObject — same for every object in a file */
interface RealmObjectContext {
  realm: Realm
  filePath: string
  plugins: Map<string, NamespacePlugin>
  statements: SqlStatement[]
  config: ResolvedConfig
  sqlOutputs: SqlOutput[]
  codeOutputs: CodeOutput[]
  docsMeta: DocsMeta[]
  errors: Array<{ namespace: string; message: string }>
  allTagOccurrences: Array<{
    objectName: string
    target: SqlTarget
    namespace: string
    tag: string | null
    args: Record<string, unknown> | unknown[]
  }>
  skippedPlugins: Set<string>
  missingNamespaces: Set<string>
  fileNamespaces: Set<string>
}

/** Process a single inspected object (table or view) and its columns for tag invocation */
function processRealmObject(obj: Table | View, target: SqlTarget, objectName: string, actx: RealmObjectContext): void {
  const {
    realm,
    filePath,
    plugins,
    statements,
    config,
    sqlOutputs,
    codeOutputs,
    docsMeta,
    errors,
    allTagOccurrences,
    skippedPlugins,
    missingNamespaces,
    fileNamespaces,
  } = actx
  // Extract tags from object-level attrs
  const objectTags = findTags(obj.attrs)

  // Object-level tags only (used as base for per-column tag sets)
  const objectTagsParsed = objectTags.map((t) => {
    const split = splitTagName(t.name)
    return { namespace: split.namespace, tag: split.tag, argsStr: t.args }
  })

  // All tags (object + all columns) for object-level callbacks
  const allObjectTagsParsed = [...objectTagsParsed]
  if (obj.columns) {
    for (const col of obj.columns) {
      const colTags = findTags(col.attrs)
      for (const ct of colTags) {
        const split = splitTagName(ct.name)
        allObjectTagsParsed.push({ namespace: split.namespace, tag: split.tag, argsStr: ct.args })
      }
    }
  }

  // Process object-level tags (table/view level)
  for (const atag of objectTags) {
    const { namespace, tag: tagName } = splitTagName(atag.name)
    const plugin = plugins.get(namespace)
    if (!plugin) {
      if (fileNamespaces.has(namespace) && !missingNamespaces.has(namespace)) {
        missingNamespaces.add(namespace)
        errors.push({
          namespace,
          message: `No plugin loaded for namespace '${namespace}'. Is '@sqldoc/ns-${namespace}' imported?`,
        })
      }
      continue
    }

    // Check plugin compatibility with target dialect
    const dialect = config.dialect
    if (!isPluginCompatible(plugin, dialect)) {
      if (!skippedPlugins.has(plugin.name)) {
        skippedPlugins.add(plugin.name)
        errors.push({
          namespace: plugin.name,
          message: `Skipped: plugin '${plugin.name}' does not support dialect '${dialect}' (supports: ${plugin.databases!.join(', ')})`,
        })
      }
      continue
    }

    const tagHandler = plugin.onTag ?? plugin.generateSQL
    if (!tagHandler && !plugin.generateCode) continue

    const args = parseTagArgs(atag.args)

    // Build namespaceTags: all tags from same namespace on this object
    const namespaceTags = allObjectTagsParsed
      .filter((t) => t.namespace === namespace)
      .map((t) => ({ tag: t.tag, args: parseTagArgs(t.argsStr) }))

    // Build siblingTags: all tags from ALL namespaces on this object
    const siblingTags = allObjectTagsParsed.map((t) => ({
      namespace: t.namespace,
      tag: t.tag,
      args: parseTagArgs(t.argsStr),
    }))

    // Track for fileTags
    allTagOccurrences.push({ objectName, target, namespace, tag: tagName, args })

    const ctx: TagContext = {
      dialect: config.dialect,
      target,
      objectName,
      tag: { name: tagName, args },
      namespaceTags,
      siblingTags,
      fileTags: [], // Placeholder — will be set after all objects processed
      astNode: null,
      fileStatements: statements,
      config: (config.namespaces?.[namespace] ?? {}) as NamespaceConfig,
      filePath,
      schemaTable: target === 'table' ? (obj as Table) : undefined,
      schemaRealm: realm,
    }

    invokePlugin(
      plugin,
      tagHandler,
      ctx,
      { namespace, tag: tagName, rawArgs: atag.args },
      sqlOutputs,
      codeOutputs,
      docsMeta,
      errors,
    )
  }

  // Process column-level tags
  if (obj.columns) {
    for (const col of obj.columns) {
      const colTags = findTags(col.attrs)
      for (const atag of colTags) {
        const { namespace, tag: tagName } = splitTagName(atag.name)
        const plugin = plugins.get(namespace)
        if (!plugin) {
          if (fileNamespaces.has(namespace) && !missingNamespaces.has(namespace)) {
            missingNamespaces.add(namespace)
            errors.push({
              namespace,
              message: `No plugin loaded for namespace '${namespace}'. Is '@sqldoc/ns-${namespace}' imported?`,
            })
          }
          continue
        }

        // Check plugin compatibility with target dialect
        const dialect = config.dialect
        if (!isPluginCompatible(plugin, dialect)) {
          if (!skippedPlugins.has(plugin.name)) {
            skippedPlugins.add(plugin.name)
            errors.push({
              namespace: plugin.name,
              message: `Skipped: plugin '${plugin.name}' does not support dialect '${dialect}' (supports: ${plugin.databases!.join(', ')})`,
            })
          }
          continue
        }

        const tagHandler = plugin.onTag ?? plugin.generateSQL
        if (!tagHandler && !plugin.generateCode) continue

        const args = parseTagArgs(atag.args)
        const columnType = col.type.raw ?? col.type.type.T

        // Build per-column tag set: object-level tags + this column's tags only
        const columnTagsParsed = [...objectTagsParsed]
        for (const ct of colTags) {
          const split = splitTagName(ct.name)
          columnTagsParsed.push({ namespace: split.namespace, tag: split.tag, argsStr: ct.args })
        }

        // Build namespaceTags from this column's scoped set
        const namespaceTags = columnTagsParsed
          .filter((t) => t.namespace === namespace)
          .map((t) => ({ tag: t.tag, args: parseTagArgs(t.argsStr) }))

        // Build siblingTags from this column's scoped set
        const siblingTags = columnTagsParsed.map((t) => ({
          namespace: t.namespace,
          tag: t.tag,
          args: parseTagArgs(t.argsStr),
        }))

        // Track for fileTags — use table.column as objectName so templates can look up per-column
        allTagOccurrences.push({
          objectName: `${objectName}.${col.name}`,
          target: 'column',
          namespace,
          tag: tagName,
          args,
        })

        const ctx: TagContext = {
          dialect: config.dialect,
          target: 'column',
          objectName,
          columnName: col.name,
          columnType,
          tag: { name: tagName, args },
          namespaceTags,
          siblingTags,
          fileTags: [], // Placeholder
          astNode: null,
          fileStatements: statements,
          config: (config.namespaces?.[namespace] ?? {}) as NamespaceConfig,
          filePath,
          schemaTable: target === 'table' ? (obj as Table) : undefined,
          schemaColumn: col,
          schemaRealm: realm,
        }

        invokePlugin(
          plugin,
          tagHandler,
          ctx,
          { namespace, tag: tagName, rawArgs: atag.args },
          sqlOutputs,
          codeOutputs,
          docsMeta,
          errors,
        )
      }
    }
  }
}

// ── Shared plugin invocation ──────────────────────────────────────────

function invokePlugin(
  plugin: NamespacePlugin,
  tagHandler: ((ctx: TagContext) => SqlOutput[] | TagOutput | undefined) | undefined,
  ctx: TagContext,
  tag: { namespace: string; tag: string | null; rawArgs: string | null },
  sqlOutputs: SqlOutput[],
  codeOutputs: CodeOutput[],
  docsMeta: DocsMeta[],
  errors: Array<{ namespace: string; message: string }>,
): void {
  const tagLabel = tag.tag
    ? `@${tag.namespace}.${tag.tag}${tag.rawArgs ? `(${tag.rawArgs})` : ''}`
    : `@${tag.namespace}${tag.rawArgs ? `(${tag.rawArgs})` : ''}`

  // Call onTag (or legacy generateSQL)
  if (tagHandler) {
    try {
      debug('compile', `invokePlugin: ${plugin.name}.onTag ${tagLabel} on ${ctx.objectName}`)
      const result = tagHandler(ctx)
      if (result) {
        // Support both SqlOutput[] and TagOutput return types
        const sqlResults = Array.isArray(result) ? result : result.sql
        if (sqlResults && sqlResults.length > 0) {
          for (const out of sqlResults) {
            if (!out.sourceTag) out.sourceTag = tagLabel
          }
          sqlOutputs.push(...sqlResults)
        }
        if (!Array.isArray(result) && result.docs) {
          docsMeta.push(result.docs)
        }
      }
    } catch (err: any) {
      const msg = `Plugin '${plugin.name}' onTag error for ${tagLabel}: ${err?.message ?? String(err)}`
      debug('compile', msg)
      errors.push({ namespace: tag.namespace, message: msg })
    }
  }

  // Call generateCode
  if (plugin.generateCode) {
    try {
      const result = plugin.generateCode(ctx)
      if (result && result.length > 0) {
        debug('compile', `invokePlugin: ${plugin.name}.generateCode produced ${result.length} file(s)`)
        codeOutputs.push(...result)
      }
    } catch (err: any) {
      const msg = `Plugin '${plugin.name}' generateCode error for ${tagLabel}: ${err?.message ?? String(err)}`
      debug('compile', msg)
      errors.push({ namespace: tag.namespace, message: msg })
    }
  }
}

// ── Merged SQL output ─────────────────────────────────────────────────

function buildMergedOutput(source: string, sqlOutputs: SqlOutput[], adapter: SqlAstAdapter, dialect: Dialect): string {
  const sourceComments = adapter.parseComments(source)
  const generatedSql = sqlOutputs.map((o) => o.sql).join('\n')
  const generatedComments = generatedSql.trim() ? adapter.parseComments(generatedSql) : []
  return buildMergedSql(source, sqlOutputs, sourceComments, generatedComments, dialect)
}

/** Comment out COMMENT ON statements in source SQL using line numbers */
function commentOutSourceComments(source: string, comments: SqlCommentOn[]): string {
  if (comments.length === 0) return source

  const lines = source.split('\n')
  const commentedLines = new Set<number>()

  for (const c of comments) {
    // c.line is 1-based, array is 0-based
    const startLine = c.line - 1
    for (let j = startLine; j < lines.length; j++) {
      commentedLines.add(j)
      if (lines[j].trim().endsWith(';')) break
    }
  }

  return lines.map((line, i) => (commentedLines.has(i) ? `-- ${line}` : line)).join('\n')
}

/**
 * COMMENT ON merging strategy: source COMMENT ON statements are commented out in the
 * original SQL, then all comments (source + generated) are merged by target key and
 * emitted as combined COMMENT ON statements at the end. Multiple comments for the same
 * target are joined with `\n` using dialect-aware string escaping.
 */
function buildMergedSql(
  source: string,
  sqlOutputs: SqlOutput[],
  sourceComments: SqlCommentOn[],
  generatedComments: SqlCommentOn[],
  dialect: Dialect,
): string {
  // 1. Build comment merge map: target -> content[]
  const commentMap = new Map<string, string[]>()
  for (const c of sourceComments) {
    commentMap.set(c.targetKey, [c.text])
  }
  for (const c of generatedComments) {
    const existing = commentMap.get(c.targetKey) ?? []
    existing.push(c.text)
    commentMap.set(c.targetKey, existing)
  }

  // 2. Build set of generated comment targetKeys for filtering
  const generatedTargets = new Set(generatedComments.map((c) => c.targetKey))

  // 3. Filter out COMMENT ON outputs from the generated SQL list
  const otherOutputs = sqlOutputs.filter((output) => {
    // Check if this output matches any generated comment target
    for (const target of generatedTargets) {
      if (output.sql.includes(target)) return false
    }
    return true
  })

  // 4. Strip @tag comments, @import lines, and comment out original COMMENT ON
  const strippedSource = stripTagsAndImports(source)
  const cleanSource = commentOutSourceComments(strippedSource, sourceComments).trimEnd()

  // 5. Build merged COMMENT ON statements
  const mergedComments: string[] = []
  for (const [target, contents] of commentMap) {
    const unique = [...new Set(contents)]
    const joined = unique.join('\n')
    const escaped = unique.length > 1 ? escapeStringWithNewlines(joined, dialect) : escapeString(unique[0], dialect)
    const sql = `COMMENT ON ${target} IS ${escaped};`
    mergedComments.push(sql)
  }

  if (otherOutputs.length === 0 && mergedComments.length === 0) {
    return source
  }

  const parts = [cleanSource]
  parts.push('')
  parts.push('-- Generated by sqldoc')

  let lastSourceTag = ''
  for (const output of otherOutputs) {
    if (output.sourceTag && output.sourceTag !== lastSourceTag) {
      parts.push(`-- sqldoc: ${output.sourceTag}`)
      lastSourceTag = output.sourceTag
    }
    if (output.comment) {
      parts.push(`-- ${output.comment}`)
    }
    parts.push(output.sql)
  }

  for (const sql of mergedComments) {
    parts.push(sql)
  }

  parts.push('')
  return parts.join('\n')
}

// ── Schema inspection helpers ────────────────────────────────────────

/**
 * Split an inspected tag name into namespace and tag name.
 * - "audit.track" -> { namespace: "audit", tag: "track" }
 * - "searchable"  -> { namespace: "searchable", tag: null } ($self pattern)
 */
function splitTagName(name: string): { namespace: string; tag: string | null } {
  const dotIdx = name.indexOf('.')
  if (dotIdx === -1) return { namespace: name, tag: null }
  return { namespace: name.substring(0, dotIdx), tag: name.substring(dotIdx + 1) }
}

/**
 * Type guard: check if an attr is a tag (has kind: 'tag').
 * Mirrors the Tag interface from @sqldoc/inspector without importing.
 */
function isTag(attr: Attr): attr is Tag {
  if (typeof attr !== 'object' || attr === null) return false
  return 'kind' in attr && (attr as any).kind === 'tag'
}

/** Extract all tag attrs from a mixed Attrs array */
function findTags(attrs?: Attr[]): Tag[] {
  if (!attrs) return []
  return attrs.filter(isTag)
}

/** Parse inspected tag args string into parsed values using the parser's parseArgs */
function parseTagArgs(argsStr: string): Record<string, unknown> | unknown[] {
  if (!argsStr) return {}
  return parseArgs(argsStr).values
}

/** Build fileTags from collected inspected tag occurrences */
function buildFileTags2(
  occurrences: Array<{
    objectName: string
    target: SqlTarget
    namespace: string
    tag: string | null
    args: Record<string, unknown> | unknown[]
  }>,
): TagContext['fileTags'] {
  const map = new Map<
    string,
    {
      objectName: string
      target: SqlTarget
      tags: Array<{ namespace: string; tag: string | null; args: Record<string, unknown> | unknown[] }>
    }
  >()

  for (const occ of occurrences) {
    const key = fileTagKey(occ)
    if (!map.has(key)) {
      map.set(key, {
        objectName: occ.objectName,
        target: occ.target,
        tags: [],
      })
    }
    map.get(key)!.tags.push({
      namespace: occ.namespace,
      tag: occ.tag,
      args: occ.args,
    })
  }

  return Array.from(map.values())
}

// ── Tier 1 helpers ───────────────────────────────────────────────────

function buildFileTags(blocks: TagBlock[]): TagContext['fileTags'] {
  return blocks.map((block) => {
    // Use table.column format for column targets (matches inspector convention)
    const objectName =
      block.ast.target === 'column' && block.ast.columnName
        ? `${block.ast.objectName ?? 'unknown'}.${block.ast.columnName}`
        : (block.ast.objectName ?? 'unknown')

    return {
      objectName,
      target: block.ast.target,
      tags: block.tags.map((t) => ({
        namespace: t.namespace,
        tag: t.tag,
        args: parsedArgsToValue(t.rawArgs),
      })),
    }
  })
}

function parsedArgsToValue(rawArgs: string | null): Record<string, unknown> | unknown[] {
  if (rawArgs === null) return {}
  const parsed = parseArgs(rawArgs)
  return parsed.values
}

/**
 * Merge parser-derived tags into schema-derived fileTags.
 *
 * Schema tag matching only sees tags that produce attrs in schema inspection.
 * Tags like @lint.ignore that don't produce SQL output are invisible to inspection, so the
 * parser-derived tags are merged in to ensure complete fileTags for lint rules and docs.
 */
function mergeParserTags(schemaFileTags: TagContext['fileTags'], parserFileTags: TagContext['fileTags']): void {
  // Index existing objects by both target and name to avoid table/column collisions.
  const byKey = new Map<string, (typeof schemaFileTags)[0]>()
  for (const obj of schemaFileTags) {
    byKey.set(fileTagKey(obj), obj)
  }

  for (const pObj of parserFileTags) {
    for (const pTag of pObj.tags) {
      // Only add tags that inspection doesn't already have (non-SQL-generating tags)
      const existing = byKey.get(fileTagKey(pObj))
      if (existing) {
        // Check if this tag already exists
        const alreadyHas = existing.tags.some((t) => t.namespace === pTag.namespace && t.tag === pTag.tag)
        if (!alreadyHas) {
          existing.tags.push(pTag)
        }
      } else {
        // Object not in inspected schema (e.g. it's on a function or something inspection didn't process)
        const newObj = { objectName: pObj.objectName, target: pObj.target, tags: [pTag] }
        schemaFileTags.push(newObj)
        byKey.set(fileTagKey(newObj), newObj)
      }
    }
  }
}

function fileTagKey(obj: { objectName: string; target: SqlTarget }): string {
  return `${obj.target}:${obj.objectName}`
}

/**
 * Strip @tag comments and @import lines from the source SQL.
 * - Lines that are entirely comment with @tags are removed
 * - Inline @tags (after SQL on the same line) have the comment portion removed
 * - Blank `--` comments left behind are removed
 * - Consecutive blank lines are collapsed
 */
function stripTagsAndImports(source: string): string {
  const TAG_RE = /@\w+(?:\.\w+)?(?:\([^)]*\))?/
  const IMPORT_RE = /^\s*--\s*@import\s/
  const lines = source.split('\n')
  const result: string[] = []

  for (const line of lines) {
    // Remove @import lines entirely
    if (IMPORT_RE.test(line)) continue

    // Check if line has a comment with a tag
    const commentIdx = line.indexOf('--')
    if (commentIdx >= 0) {
      const commentPart = line.substring(commentIdx)
      if (TAG_RE.test(commentPart)) {
        const sqlPart = line.substring(0, commentIdx).trimEnd()
        if (sqlPart) {
          // Inline tag — keep the SQL, remove the comment
          result.push(sqlPart)
        }
        // Else: entire line was a tag comment — skip it
        continue
      }
    }

    // Remove blank comments (just `--` with optional whitespace)
    if (/^\s*--\s*$/.test(line)) continue

    result.push(line)
  }

  // Collapse consecutive blank lines to a single blank line
  const collapsed: string[] = []
  let lastBlank = false
  for (const line of result) {
    const isBlank = line.trim() === ''
    if (isBlank && lastBlank) continue
    collapsed.push(line)
    lastBlank = isBlank
  }

  return collapsed.join('\n')
}
