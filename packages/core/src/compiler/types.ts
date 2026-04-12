import type { SqlStatement } from '../ast/types.ts'
import type { FileProvenance } from '../directives.ts'
import type { Dialect } from '../sql-emitter.ts'
import type { SqlTarget, TagNamespace } from '../types.ts'

// ── Project config ──────────────────────────────────────────────────

/** Migration file format — determines how up/down scripts are read and written */
export type MigrationFormat = 'atlas' | 'golang-migrate' | 'goose' | 'flyway' | 'dbmate' | 'plain'

/** File naming strategy for generated migration files */
export type MigrationNaming = 'timestamp' | 'sequential' | { provider: 'claude-code' }

/** A single project configuration */
export interface ProjectConfig<Namespaces = Record<string, unknown>> {
  /** Project name (required for multi-project, optional for single) */
  name?: string
  /** Schema source: file or directory of SQL files with sqldoc tags */
  schema?: string
  /** SQL dialect — mandatory */
  dialect: Dialect
  /** Dev database URL. Default: pglite */
  devUrl?: string
  /** Migration settings */
  migrations?: {
    /** Directory containing migration files */
    dir: string
    /** Migration file format. Default: 'plain' */
    format?: MigrationFormat
    /** File naming strategy. Default: 'timestamp' */
    naming?: MigrationNaming
    /** Format migration SQL with sql-formatter before saving */
    pretty?: boolean
  }
  /** Namespace plugin configuration */
  namespaces?: Namespaces
  /** Lint configuration */
  lint?: LintConfig
  /** Codegen options */
  codegen?: {
    /** When true, codegen receives a filtered realm with external objects removed. Default: false. */
    skipExternal?: boolean
  }

  // ── Legacy fields (backward compat) ──
  /** @deprecated Use `schema` instead. Glob patterns for SQL source files */
  include?: string[]
  /** Output directory for generated SQL */
  sqlOutDir?: string
  /** Output directory for generated code artifacts */
  codeOutDir?: string
}

/** Config can be a single project or array of projects */
export type SqldocConfig<Namespaces = Record<string, unknown>> = ProjectConfig<Namespaces> | ProjectConfig<Namespaces>[]

/**
 * Resolved single-project config — always a single ProjectConfig.
 * Used internally after resolving --project/--all flags.
 */
export type ResolvedConfig = ProjectConfig

/** Generic constraint for per-namespace config */
export type NamespaceConfig = Record<string, unknown>

// ── Tag context ────────────────────────────────────────────────────

/** Rich context passed to onTag for each tag occurrence */
export interface TagContext {
  /** Target database dialect */
  dialect: Dialect
  /** The SQL object this tag is attached to */
  target: SqlTarget
  /** Name of the SQL object (table name, function name, etc.) */
  objectName: string
  /** Column name when target is 'column' */
  columnName?: string
  /** Column data type when target is 'column' */
  columnType?: string
  /** The parsed tag that triggered this handler */
  tag: {
    name: string | null
    args: Record<string, unknown> | unknown[]
  }
  /** All tags from the same namespace on the same SQL object */
  namespaceTags: Array<{
    tag: string | null
    args: Record<string, unknown> | unknown[]
  }>
  /** All tags from ALL namespaces on the same SQL object (sibling introspection) */
  siblingTags: Array<{
    namespace: string
    tag: string | null
    args: Record<string, unknown> | unknown[]
  }>
  /** All tags across the entire file, grouped by SQL object */
  fileTags: Array<{
    objectName: string
    target: SqlTarget
    tags: Array<{
      namespace: string
      tag: string | null
      args: Record<string, unknown> | unknown[]
    }>
  }>
  /** The full AST statement for the SQL object */
  astNode: unknown
  /** All parsed SQL statements in the file */
  fileStatements: SqlStatement[]
  /** This namespace's config from sqldoc.config.ts */
  config: NamespaceConfig
  /** The source SQL file path */
  filePath: string
  /** Atlas-parsed table schema for this object (Tier 2 only, undefined in Tier 1) */
  atlasTable?: unknown
  /** Atlas-parsed column info (Tier 2 only, when target is 'column') */
  atlasColumn?: unknown
  /** Full Atlas realm with all schemas, tables, views (Tier 2 only) */
  atlasRealm?: unknown
}

/** @deprecated Use TagContext instead */
export type CompilerContext = TagContext

/** Context for afterCompile hook — receives ALL compiled file data */
export interface ProjectContext {
  /** Target database dialect */
  dialect: Dialect
  /** All compiled file outputs */
  outputs: CompilerOutput[]
  /** The merged SQL from all files combined */
  mergedSql: string
  /** All tags across all files, grouped by file then by object */
  allFileTags: Array<{
    sourceFile: string
    objects: Array<{
      objectName: string
      target: SqlTarget
      tags: Array<{
        namespace: string
        tag: string | null
        args: Record<string, unknown> | unknown[]
      }>
    }>
  }>
  /** Aggregated docs metadata from all plugins across all files */
  docsMeta: DocsMeta[]
  /** This namespace's config from sqldoc.config.ts */
  config: NamespaceConfig
  /** Project root directory */
  projectRoot: string
  /** Atlas-parsed schema realm (Tier 2, when available) */
  atlasRealm?: unknown
  /** Set of object names (table/view) from @external files. Used by codegen for annotation and skipExternal filtering. */
  externalObjectNames?: Set<string>
}

/** @deprecated Use ProjectContext instead */
export type ProjectCompilerContext = ProjectContext

/** Output from an afterCompile hook */
export interface ProjectOutput {
  /** Files to write (path relative to project root + content) */
  files: Array<{
    filePath: string
    content: string
  }>
}

// ── Docs metadata ──────────────────────────────────────────────────

/** Documentation metadata that plugins can return alongside SQL from onTag */
export interface DocsMeta {
  /** Extra relationships to show in ER diagrams (e.g. audit trail arrows) */
  relationships?: Array<{
    from: string
    to: string
    label: string
    style?: 'dashed'
  }>
  /** Table-level annotations (e.g. "RLS enabled", "Audited") */
  annotations?: Array<{
    object: string
    text: string
  }>
  /**
   * Extra doc columns contributed by plugins.
   * If ANY plugin adds a column with a given header, that column appears on ALL tables.
   * Each entry targets a specific table+column with a cell value.
   */
  columns?: Array<{
    /** Column header name (e.g. "Validation", "RLS", "Anonymization") */
    header: string
    /** Table this cell applies to */
    object: string
    /** DB column name this cell applies to (omit for table-level row) */
    column?: string
    /** Cell value text */
    value: string
  }>
}

/** Return type from onTag — SQL statements + optional docs metadata */
export interface TagOutput {
  sql?: SqlOutput[]
  docs?: DocsMeta
}

// ── Compiler outputs ────────────────────────────────────────────────

/** A single SQL statement produced by a namespace */
export interface SqlOutput {
  /** The SQL statement text (e.g., "ALTER TABLE users ENABLE ROW LEVEL SECURITY;") */
  sql: string
  /** Optional comment for clarity in output */
  comment?: string
  /** Source tag that produced this output (set by compiler, not by plugins) */
  sourceTag?: string
}

/** A non-SQL file produced by a namespace */
export interface CodeOutput {
  /** Relative file path for the output (e.g., "types/users.ts") */
  filePath: string
  /** File content */
  content: string
}

/** Combined output from compiling one file */
export interface CompilerOutput {
  /** Source SQL file path */
  sourceFile: string
  /** File provenance: project, external, or include */
  provenance?: FileProvenance
  /** Complete SQL: original source with generated statements appended */
  mergedSql: string
  /** Individual SQL statements produced by namespaces (for inspection) */
  sqlOutputs: SqlOutput[]
  /** Code files to write */
  codeOutputs: CodeOutput[]
  /** Errors encountered during compilation */
  errors: Array<{ namespace: string; message: string }>
  /** Documentation metadata collected from all plugins */
  docsMeta: DocsMeta[]
  /** Per-file tag summary for project-level aggregation */
  fileTags: Array<{
    objectName: string
    target: SqlTarget
    tags: Array<{
      namespace: string
      tag: string | null
      args: Record<string, unknown> | unknown[]
    }>
  }>
}

// ── Lint types ──────────────────────────────────────────────────────

/** Severity levels for lint rules */
export type LintSeverity = 'error' | 'warn' | 'off'

/** A lint rule defined by a namespace plugin */
export interface LintRule {
  /** Full rule name: namespace.ruleName (e.g. "audit.require-audit") */
  name: string
  /** Human-readable description of what this rule checks */
  description: string
  /** Default severity when not overridden in config */
  default: LintSeverity
  /** Check function — receives the full lint context and returns diagnostics */
  check: (ctx: LintContext) => LintDiagnostic[]
}

/** Context passed to lint rule check functions */
export interface LintContext {
  /** All compiled file outputs */
  outputs: CompilerOutput[]
  /** All loaded plugins, keyed by namespace name */
  plugins: Map<string, NamespacePlugin>
  /** Project config (resolved single project) */
  config: ResolvedConfig
  /** Atlas realm from schema inspection (Tier 2 only, undefined in VSCode) */
  atlasRealm?: unknown
}

/** A single lint diagnostic produced by a rule */
export interface LintDiagnostic {
  /** The SQL object this diagnostic relates to (table name, etc.) */
  objectName: string
  /** Source file path */
  sourceFile: string
  /** Human-readable message */
  message: string
}

/** A lint result after applying severity and ignore processing */
export interface LintResult {
  /** Rule that produced this result */
  ruleName: string
  /** Effective severity (after config override, 'skip' if @lint.ignore suppressed) */
  severity: LintSeverity | 'skip'
  /** The SQL object name */
  objectName: string
  /** Source file path */
  sourceFile: string
  /** Human-readable message */
  message: string
  /** Ignore reason (when severity is 'skip') */
  ignoreReason?: string
}

/** Lint config section in sqldoc.config.ts */
export interface LintConfig {
  rules?: Record<string, LintSeverity>
}

// ── Namespace plugin contract ───────────────────────────────────────

/** Stable type contract for namespace packages. Extends TagNamespace with compiler hooks. */
export interface NamespacePlugin extends TagNamespace {
  /** API version for forward compatibility. Must be 1 for v1. */
  apiVersion: 1
  /** Which databases this plugin supports. Omit = all databases. */
  databases?: Array<Dialect>
  /** Human-readable description of the plugin */
  description?: string
  /** Discovery keywords for plugin search */
  keywords?: string[]
  /** JSON Schema or Zod-like descriptor for namespace config (optional). Reserved for future validation. */
  configSchema?: unknown
  /** Called for each tag occurrence — returns SQL statements and/or docs metadata */
  onTag?: (ctx: TagContext) => SqlOutput[] | TagOutput | undefined
  /** Generate non-SQL code artifacts for a tag occurrence */
  generateCode?: (ctx: TagContext) => CodeOutput[] | undefined
  /** Runs once after all per-file compilation completes — project-level aggregation */
  afterCompile?: (ctx: ProjectContext) => Promise<ProjectOutput> | ProjectOutput
  /** Lint rules defined by this plugin */
  lintRules?: LintRule[]

  // Deprecated aliases — will be removed in v2
  /** @deprecated Use onTag instead */
  generateSQL?: (ctx: TagContext) => SqlOutput[] | TagOutput | undefined
  /** @deprecated Use afterCompile instead */
  generateProject?: (ctx: ProjectContext) => Promise<ProjectOutput> | ProjectOutput
}
