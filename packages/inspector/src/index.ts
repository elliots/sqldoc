// Derived from Atlas by Atlas Authors, licensed under Apache 2.0

// Main API
export { createInspector } from './inspector.ts'
export type { InspectorOptions, InspectorRunner, DiffSource } from './inspector.ts'

// Marshal
export { marshalRealm, typeCategory, marshalColumn, marshalColumnType } from './marshal.ts'

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
  UnsupportedType,
  UUIDType,
  View,
} from './schema/schema.ts'

// Inspect interfaces
export { DiffMode, InspectMode, isNotExistError, NotExistError } from './schema/inspect.ts'
export type {
  Differ,
  DiffOptions,
  ExecQuerier,
  ExecResult,
  Inspector,
  InspectOptions,
  InspectRealmOption,
  Normalizer,
  QueryResult,
} from './schema/inspect.ts'

// Migration / Change types
export { ChangeKind, Changes } from './schema/migrate.ts'
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

// Tag helpers
export { findTag, findTags, hasTag } from './schema/tag.ts'

// Exclusion filtering
export { excludeRealm, excludeSchema, matchPattern } from './schema/exclude.ts'

// Migrate: Lexer
export { directive, Scanner, scanStmts, stmtDirective, stmts } from './migrate/lex.ts'
export type { ScannerOptions, Stmt } from './migrate/lex.ts'

// Migrate: Tags
export { extractTagsFromStmts, parseStmtTags, parseTableName, parseTags, stmtTags } from './migrate/tag.ts'
export type { TagIndex } from './migrate/tag.ts'

// Migrate: Dir
export { LocalFile, MemDir } from './migrate/dir.ts'
export type { Dir, File } from './migrate/dir.ts'

// Migrate: Types
export type {
  Driver,
  Normalizer as MigrateNormalizer,
  PlanChange,
  Snapshoter,
  Inspector as MigrateInspector,
  Differ as MigrateDiffer,
  ExecQuerier as MigrateExecQuerier,
  PlanApplier as MigratePlanApplier,
  Plan as MigratePlan,
} from './migrate/migrate.ts'

// sqltool formatters
export {
  golangMigrateFormatter,
  gooseFormatter,
  flywayFormatter,
  liquibaseFormatter,
  dbmateFormatter,
} from './sqltool/tool.ts'
export type { Formatter, MigrationFile } from './sqltool/tool.ts'
