// Derived from Atlas by Atlas Authors, licensed under Apache 2.0

// Database adapter interface
export type { DatabaseAdapter, ExecResult, QueryResult } from './adapter.ts'
export type { Dialect, DiffSource, InspectorOptions, InspectorResult, InspectorRunner } from './inspector.ts'
// Main API
export { createInspector } from './inspector.ts'

// Type utilities
export { isCustomType, typeCategory } from './marshal.ts'
export type { Dir, File } from './migrate/dir.ts'
// Migrate: Dir
export { LocalFile, MemDir } from './migrate/dir.ts'
export type { ScannerOptions, Stmt } from './migrate/lex.ts'
// Migrate: Lexer
export { directive, Scanner, scanStmts, stmtDirective, stmts } from './migrate/lex.ts'
// Migrate: Types
export type {
  Differ as MigrateDiffer,
  Driver,
  ExecQuerier as MigrateExecQuerier,
  Inspector as MigrateInspector,
  Normalizer as MigrateNormalizer,
  Plan as MigratePlan,
  PlanApplier as MigratePlanApplier,
  PlanChange,
  Snapshoter,
} from './migrate/migrate.ts'
export type { TagIndex } from './migrate/tag.ts'
// Migrate: Tags
export { extractTagsFromStmts, parseStmtTags, parseTableName, parseTags, stmtTags } from './migrate/tag.ts'
// DSL builder functions
export {
  commentFor,
  enumValues,
  findColumn,
  findIndex,
  findTable,
  hasAttr,
  newCheck,
  newColumn,
  newForeignKey,
  newFunc,
  newIndex,
  newProc,
  newSequence,
  newTable,
  newTrigger,
  newView,
  setAttr,
} from './schema/dsl.ts'
// Exclusion filtering
export { excludeRealm, excludeSchema, matchPattern } from './schema/exclude.ts'
export type {
  Differ,
  DiffOptions,
  ExecQuerier,
  ExecResult as InspectExecResult,
  InspectOptions,
  Inspector,
  InspectRealmOption,
  Normalizer,
  QueryResult as InspectQueryResult,
} from './schema/inspect.ts'
// Inspect interfaces
export { DiffMode, InspectMode, isNotExistError, NotExistError } from './schema/inspect.ts'
export type {
  AddAttr,
  AddCheck,
  AddColumn,
  AddForeignKey,
  AddFunc,
  AddIndex,
  AddObject,
  AddPolicy,
  AddPrimaryKey,
  AddProc,
  AddSchema,
  AddSequence,
  AddTable,
  AddTrigger,
  AddView,
  Change,
  Clause,
  DropAttr,
  DropCheck,
  DropColumn,
  DropForeignKey,
  DropFunc,
  DropIndex,
  DropObject,
  DropPolicy,
  DropPrimaryKey,
  DropProc,
  DropSchema,
  DropSequence,
  DropTable,
  DropTrigger,
  DropView,
  IfExists,
  IfNotExists,
  ModifyAttr,
  ModifyCheck,
  ModifyColumn,
  ModifyForeignKey,
  ModifyFunc,
  ModifyIndex,
  ModifyObject,
  ModifyPolicy,
  ModifyPrimaryKey,
  ModifyProc,
  ModifySchema,
  ModifySequence,
  ModifyTable,
  ModifyTrigger,
  ModifyView,
  Plan,
  PlanApplier,
  RenameColumn,
  RenameConstraint,
  RenameFunc,
  RenameIndex,
  RenameObject,
  RenameProc,
  RenameTable,
  RenameTrigger,
  RenameView,
} from './schema/migrate.ts'
// Migration / Change types
export { ChangeKind, Changes } from './schema/migrate.ts'
// Schema types
export type {
  ArrayType,
  Attr,
  BinaryType,
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
  UnsupportedType,
  UUIDType,
  View,
} from './schema/schema.ts'
// Tag helpers
export { findTag, findTags, hasTag } from './schema/tag.ts'
export type { Formatter, MigrationFile } from './sqltool/tool.ts'
// sqltool formatters
export {
  dbmateFormatter,
  flywayFormatter,
  golangMigrateFormatter,
  gooseFormatter,
  liquibaseFormatter,
} from './sqltool/tool.ts'
