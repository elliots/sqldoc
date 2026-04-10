// @sqldoc/db -- Database adapters and schema types for sqldoc
// Schema types are re-exported from @sqldoc/inspector.

import { createMysqlDockerAdapter } from './db/mysql-docker.ts'
import type { OnMissingPlugin } from './db/plugin-resolver.ts'
import { resolveAdapterPlugin } from './db/plugin-resolver.ts'
import { createPostgresDockerAdapter } from './db/postgres-docker.ts'
import { validatePostgresExtensions } from './extensions.ts'

// Re-export schema types from @sqldoc/inspector
export type {
  // Schema types
  ArrayType,
  Attr,
  BinaryType,
  BoolType,
  Cast,
  // Change types
  Change,
  Charset,
  Check,
  Collation,
  Column,
  ColumnType,
  Comment,
  CompositeType,
  CurrencyType,
  // Database adapter interface (canonical definition)
  DatabaseAdapter,
  DecimalType,
  // Inspect interfaces
  Differ,
  DiffOptions,
  // Inspector API
  DiffSource,
  DomainType,
  EnumType,
  EventTrigger,
  ExecQuerier,
  ExecResult,
  Expr,
  Extension,
  FloatType,
  ForeignKey,
  Func,
  FuncArg,
  GeneratedExpr,
  Index,
  IndexPart,
  InspectOptions,
  Inspector,
  InspectorOptions,
  InspectorResult,
  InspectorRunner,
  InspectRealmOption,
  IntegerType,
  IntervalType,
  JSONType,
  Literal,
  NetworkType,
  Normalizer,
  ObjectRef,
  Operator,
  Plan,
  PlanApplier,
  Policy,
  Proc,
  QueryResult,
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
} from '@sqldoc/inspector'
export {
  ChangeKind,
  Changes,
  // DSL builder functions
  commentFor,
  // Inspector factory
  createInspector,
  // Inspect enums/classes
  DiffMode,
  enumValues,
  // Exclusion filtering
  excludeRealm,
  excludeSchema,
  findColumn,
  findIndex,
  findTable,
  // Tag helpers
  findTag,
  findTags,
  hasAttr,
  hasTag,
  InspectMode,
  // Type utilities
  isCustomType,
  isNotExistError,
  matchPattern,
  NotExistError,
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
  typeCategory,
} from '@sqldoc/inspector'
export { createMysqlDockerAdapter } from './db/mysql-docker.ts'
export type { OnMissingPlugin } from './db/plugin-resolver.ts'
export { extractScheme, registerBuiltin, resolveAdapterPlugin, schemeToPackage } from './db/plugin-resolver.ts'
export { createPostgresDockerAdapter } from './db/postgres-docker.ts'
export { createSqliteAdapter } from './db/sqlite.ts'
export type {
  AdapterPluginContext,
  DatabaseAdapterPlugin,
} from './db/types.ts'
export { createBunSqlAdapter, isBun, normalizeValue } from './db/types.ts'
export { extractExtensions, validatePostgresExtensions } from './extensions.ts'

export interface CreateRunnerConfig {
  /** SQL dialect (required) */
  dialect: 'postgres' | 'mysql' | 'sqlite'
  /** Database connection URL. If omitted, uses dialect-specific default. */
  devUrl?: string
  /** Postgres extensions to load. Validated against the dev database. */
  extensions?: string[]
  /** Path to .sqldoc/ directory for plugin package resolution */
  sqldocDir?: string
  /** Called when a plugin package is missing. CLI provides auto-install. */
  onMissingPlugin?: OnMissingPlugin
}

function defaultDevUrl(dialect: 'postgres' | 'mysql' | 'sqlite'): string {
  switch (dialect) {
    case 'postgres':
      return 'pglite'
    case 'sqlite':
      return ':memory:'
    case 'mysql':
      return 'docker://mysql:8'
  }
}

/**
 * Create a DatabaseAdapter from a dialect + devUrl.
 *
 * All adapters go through the plugin resolver. Built-in plugins (Bun SQL,
 * SQLite) are registered at import time. External plugins (@sqldoc/db-*)
 * are loaded from .sqldoc/node_modules/ and auto-installed on first use.
 *
 * Docker is the only special case — it orchestrates a container, then
 * delegates to the plugin system for the actual DB connection.
 */
export async function createAdapter(config: CreateRunnerConfig): Promise<import('./db/types.ts').DatabaseAdapter> {
  const dialect = config.dialect
  const devUrl = config.devUrl ?? defaultDevUrl(dialect)
  const extensions = dialect === 'postgres' ? (config.extensions ?? []) : []
  const pluginOpts = {
    context: { dialect, extensions },
    sqldocDir: config.sqldocDir,
    onMissingPlugin: config.onMissingPlugin,
  }

  let db: import('./db/types.ts').DatabaseAdapter

  if (devUrl.startsWith('docker://') || devUrl.startsWith('dockerfile://')) {
    if (dialect === 'mysql') {
      db = await createMysqlDockerAdapter(devUrl, pluginOpts)
    } else if (dialect === 'postgres') {
      db = await createPostgresDockerAdapter(devUrl, pluginOpts)
    } else {
      throw new Error(`Docker dev URLs are not supported for dialect '${dialect}'`)
    }
  } else {
    db = await resolveAdapterPlugin({ devUrl, ...pluginOpts })
  }

  // Validate postgres extensions against the live database
  if (dialect === 'postgres' && extensions.length > 0) {
    if (process.env.DEBUG) console.error(`[runner] validating extensions: ${extensions.join(', ')}`)
    try {
      await validatePostgresExtensions(extensions, (sql) => db.query(sql))
    } catch (err) {
      await db.close()
      throw err
    }
    if (process.env.DEBUG) console.error('[runner] extensions validated')
  }

  return db
}

/**
 * Create an inspector with sensible defaults.
 * Uses createAdapter() internally, then wraps the adapter in the inspector.
 */
export async function createRunner(config: CreateRunnerConfig): Promise<import('@sqldoc/inspector').InspectorRunner> {
  const { createInspector } = await import('@sqldoc/inspector')
  const db = await createAdapter(config)
  try {
    return await createInspector({ db, dialect: config.dialect })
  } catch (err) {
    try {
      await db.close()
    } catch {}
    throw err
  }
}
