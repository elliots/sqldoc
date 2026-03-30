// Types

export type { SqlAstAdapter, SqlColumn, SqlCommentOn, SqlStatement } from './ast/index.ts'
// Directives
export type { FileDirective, FileProvenance } from './directives.ts'
export { EXTERNAL_RE, INCLUDE_RE, parseDirectives } from './directives.ts'
// Resolver
export type { ResolvedFiles } from './resolver.ts'
export { resolveDirectives } from './resolver.ts'
// AST Adapters
export { SqlparserTsAdapter } from './ast/index.ts'
// Blocks
export { buildBlocks } from './blocks.ts'
export type {
  CodeOutput,
  CompileOptions,
  CompilerContext,
  // CompilerContext is deprecated alias for TagContext
  CompilerOutput,
  ConfigResult,
  DocsMeta,
  LintConfig,
  LintContext,
  LintDiagnostic,
  LintResult,
  LintRule,
  LintSeverity,
  MigrationFormat,
  MigrationNaming,
  NamespaceConfig,
  NamespacePlugin,
  ProjectCompilerContext, // ProjectCompilerContext is deprecated alias
  ProjectConfig,
  ProjectContext,
  ProjectOutput,
  ResolvedConfig,
  SqldocConfig,
  SqlOutput,
  TagContext,
  TagOutput,
} from './compiler/index.ts'
// Compiler
export { compile, defineConfig, loadConfig, resolveAllProjects, resolveProject } from './compiler/index.ts'
// Lint engine
export { lint } from './lint.ts'
export type { ImportError, LoadResult } from './loader.ts'
// Loader
export { loadImports, setImportLogger } from './loader.ts'
export type { ArgValue, ImportStatement, ParsedArgs, ParsedTag, ParseResult } from './parser.ts'
// Parser
export { parse, parseArgs } from './parser.ts'

// SQL Emitter
export type { Dialect } from './sql-emitter.ts'
export {
  autoIncrementType,
  commentOn,
  currentTimestamp,
  escapeString,
  escapeStringWithNewlines,
  jsonObjectFunction,
  jsonType,
  quoteIdentifier,
  timestampType,
} from './sql-emitter.ts'

// TS import helper
export { tsImport } from './ts-import.ts'
export type {
  ArgType,
  ArrayType,
  BooleanType,
  EnumType,
  InferArgType,
  InferSchema,
  NamedArgs,
  NamespaceDef,
  NoArgs,
  NumberType,
  PositionalArgs,
  SqlTarget,
  StringType,
  TagArgs,
  TagDef,
  TagNamespace,
  ValidationContext,
} from './types.ts'
// Shared utilities
export { findSqldocDir, unwrapDefault } from './utils.ts'
export type { AstInfo, Diagnostic } from './validator.ts'
// Validator
export { detectTarget, detectTargetFallback, validate } from './validator.ts'
