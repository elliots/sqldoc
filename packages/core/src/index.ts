// Types

export type { SqlAstAdapter, SqlColumn, SqlCommentOn, SqlStatement } from './ast/index.ts'
// AST Adapters
export { createAstAdapter, PostgresAstAdapter, SqlparserTsAdapter } from './ast/index.ts'
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
export {
  compile,
  defineConfig,
  findConfigRoot,
  loadConfig,
  resolveAllProjects,
  resolveProject,
} from './compiler/index.ts'
// Debug
export { debug, setDebugLogger } from './debug.ts'
export type { DatabaseEngine, DatabaseEngineSpec, DialectSpec } from './dialects.ts'
export {
  defaultDevUrlForDialect,
  defaultDevUrlForEngine,
  defaultSchemaForDialect,
  defaultSchemaForEngine,
  dialectForEngine,
  getDialectSpec,
  getEngineSpec,
} from './dialects.ts'
// Directives
export type { FileDirective, FileProvenance } from './directives.ts'
export { EXTERNAL_RE, INCLUDE_RE, parseDirectives } from './directives.ts'
// Lint engine
export { lint } from './lint.ts'
export type { ImportError, LoadResult } from './loader.ts'
// Loader
export { loadImports, setImportLogger } from './loader.ts'
// Package installer hook
export type { PackageInstaller } from './packages.ts'
export { installPackages, setPackageInstaller } from './packages.ts'
export type { ArgValue, ImportStatement, ParsedArgs, ParsedTag, ParseResult } from './parser.ts'
// Parser
export { parse, parseArgs } from './parser.ts'
// Resolver
export type { ResolvedFiles } from './resolver.ts'
export { resolveDirectives } from './resolver.ts'
export type {
  ArrayType,
  Attr,
  BinaryType,
  BitType,
  BoolType,
  Cast,
  Charset,
  Check,
  Collation,
  Column,
  ColumnType,
  Comment,
  CompositeType,
  CurrencyType,
  DecimalType,
  DomainType,
  EnumType,
  EventTrigger,
  Expr,
  Extension,
  FloatType,
  ForeignKey,
  Func,
  FuncArg,
  GeneratedExpr,
  Index,
  IndexPart,
  IntegerType,
  IntervalType,
  JSONType,
  Literal,
  NetworkType,
  ObjectRef,
  OIDType,
  Operator,
  Policy,
  Proc,
  RangeType,
  RawExpr,
  Realm,
  ReferenceAction,
  Rename,
  RenameCandidate,
  Schema,
  SchemaType,
  Sequence,
  SerialType,
  SpatialType,
  StringType,
  Table,
  Tag,
  TextSearchType,
  TimeType,
  Trigger,
  TypeCategory,
  UnknownType,
  UnsupportedType,
  UUIDType,
  View,
  XMLType,
} from './schema.ts'
export {
  getForeignKeys,
  getPrimaryKeyColumns,
  getSchemaColumns,
  getSchemaRealm,
  getSchemaTable,
  getSchemaTables,
} from './schema-context.ts'
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
  ArrayType as ArrayArgType,
  BooleanType as BooleanArgType,
  EnumType as EnumArgType,
  InferArgType,
  InferSchema,
  NamedArgs,
  NamespaceDef,
  NoArgs,
  NumberType as NumberArgType,
  PositionalArgs,
  SqlTarget,
  StringType as StringArgType,
  TagArgs,
  TagDef,
  TagNamespace,
  ValidationContext,
} from './types.ts'
// Shared utilities
export { findSqldocDir, unwrapDefault } from './utils.ts'
export type { AstInfo, Diagnostic } from './validator.ts'
// Validator
export { detectTarget, validate } from './validator.ts'
