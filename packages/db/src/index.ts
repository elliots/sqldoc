// @sqldoc/db -- Database adapters and schema types for sqldoc
// Schema types are re-exported from @sqldoc/inspector.

import type { DatabaseEngine } from '@sqldoc/core'
import { defaultDevUrlForEngine, getEngineSpec, resolveDatabaseEngine } from '@sqldoc/core'
import { createMssqlDockerAdapter } from './db/mssql-docker.ts'
import { createMysqlDockerAdapter } from './db/mysql-docker.ts'
import type { OnMissingPlugin, ResolvePluginOptions } from './db/plugin-resolver.ts'
import { resolveAdapterPlugin } from './db/plugin-resolver.ts'
import { createPostgresDockerAdapter } from './db/postgres-docker.ts'
import type { AdapterPluginContext, DatabaseAdapter, DatabaseAdapterPlugin, Dialect } from './db/types.ts'
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

import type { InspectorRunner } from '@sqldoc/inspector'

export type { DatabaseEngine, DatabaseEngineSpec, DialectSpec } from '@sqldoc/core'
export {
  defaultDevUrlForDialect,
  defaultDevUrlForEngine,
  defaultSchemaForDialect,
  defaultSchemaForEngine,
  dialectForEngine,
  getDialectSpec,
  getEngineSpec,
} from '@sqldoc/core'
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
export type { MssqlDockerOptions } from './db/mssql-docker.ts'
export { createMssqlDockerAdapter } from './db/mssql-docker.ts'
export { createMysqlDockerAdapter } from './db/mysql-docker.ts'
export type { OnMissingPlugin } from './db/plugin-resolver.ts'
export { extractScheme, registerBuiltin, resolveAdapterPlugin, schemeToPackage } from './db/plugin-resolver.ts'
export { createPostgresDockerAdapter } from './db/postgres-docker.ts'
export { createSqliteAdapter } from './db/sqlite.ts'
export type {
  AdapterPluginContext,
  DatabaseAdapterPlugin,
  Dialect,
} from './db/types.ts'
export { createBunSqlAdapter, isBun, normalizeValue } from './db/types.ts'

export { extractExtensions, validatePostgresExtensions } from './extensions.ts'

export interface CreateRunnerConfig {
  /** SQL engine variant (for example postgres, crdb, tidb). */
  engine: DatabaseEngine
  /** Database connection URL. If omitted, uses dialect-specific default. */
  devUrl?: string
  /** Postgres extensions to load. Validated against the dev database. */
  extensions?: string[]
  /** Path to .sqldoc/ directory for plugin package resolution */
  sqldocDir?: string
  /** Called when a plugin package is missing. CLI provides auto-install. */
  onMissingPlugin?: OnMissingPlugin
  /** Provide the adapter plugin directly, bypassing plugin resolution. */
  adapterPlugin?: DatabaseAdapterPlugin
}

type DockerAdapterOptions = Pick<ResolvePluginOptions, 'sqldocDir' | 'onMissingPlugin'> & {
  adapterPlugin?: DatabaseAdapterPlugin
}

type DockerAdapterFactory = (devUrl: string, options: DockerAdapterOptions) => Promise<DatabaseAdapter>

interface DialectAdapterRuntime {
  createContext(dialect: Dialect, config: CreateRunnerConfig): AdapterPluginContext
  createDockerAdapter?: DockerAdapterFactory
  validateAdapter?: (db: DatabaseAdapter, context: AdapterPluginContext) => Promise<void>
}

const DIALECT_ADAPTER_RUNTIMES: Record<Dialect, DialectAdapterRuntime> = {
  postgres: {
    createContext: (_dialect, config) => ({ dialect: 'postgres', extensions: config.extensions ?? [] }),
    createDockerAdapter: createPostgresDockerAdapter,
    validateAdapter: async (db, context) => {
      if (context.extensions.length === 0) return
      if (process.env.DEBUG) console.error(`[runner] validating extensions: ${context.extensions.join(', ')}`)
      await validatePostgresExtensions(context.extensions, (sql) => db.query(sql))
      if (process.env.DEBUG) console.error('[runner] extensions validated')
    },
  },
  mysql: {
    createContext: () => ({ dialect: 'mysql', extensions: [] }),
    createDockerAdapter: createMysqlDockerAdapter,
  },
  sqlite: {
    createContext: () => ({ dialect: 'sqlite', extensions: [] }),
  },
  mssql: {
    createContext: () => ({ dialect: 'mssql', extensions: [] }),
    createDockerAdapter: (devUrl, options) =>
      createMssqlDockerAdapter(devUrl, {
        reuseContainer: true,
        ...options,
      }),
  },
}

function getDialectAdapterRuntime(dialect: Dialect): DialectAdapterRuntime {
  return DIALECT_ADAPTER_RUNTIMES[dialect]
}

function getEngineAdapterRuntime(engine: DatabaseEngine): DialectAdapterRuntime & { dialect: Dialect } {
  const dialect = getEngineSpec(engine).dialect
  return {
    dialect,
    ...getDialectAdapterRuntime(dialect),
  }
}

function isDockerDevUrl(devUrl: string): boolean {
  return devUrl.startsWith('docker://') || devUrl.startsWith('dockerfile://')
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
export async function createAdapter(config: CreateRunnerConfig): Promise<DatabaseAdapter> {
  const engine = resolveDatabaseEngine(config, 'createAdapter')
  const runtime = getEngineAdapterRuntime(engine)
  const { dialect } = runtime
  const devUrl = config.devUrl ?? defaultDevUrlForEngine(engine)
  const context = runtime.createContext(dialect, config)
  const pluginOpts = {
    context,
    sqldocDir: config.sqldocDir,
    onMissingPlugin: config.onMissingPlugin,
    adapterPlugin: config.adapterPlugin,
  }

  let db: DatabaseAdapter

  if (isDockerDevUrl(devUrl)) {
    const createDockerAdapter = runtime.createDockerAdapter
    if (!createDockerAdapter) {
      throw new Error(`Docker dev URLs are not supported for dialect '${dialect}'`)
    }
    db = await createDockerAdapter(devUrl, pluginOpts)
  } else {
    db = await resolveAdapterPlugin({ devUrl, ...pluginOpts })
  }

  if (runtime.validateAdapter) {
    try {
      await runtime.validateAdapter(db, context)
    } catch (err) {
      await db.close()
      throw err
    }
  }

  return db
}

/**
 * Create an inspector with sensible defaults.
 * Uses createAdapter() internally, then wraps the adapter in the inspector.
 */
export async function createRunner(config: CreateRunnerConfig): Promise<InspectorRunner> {
  const { createInspector } = await import('@sqldoc/inspector')
  const engine = resolveDatabaseEngine(config, 'createRunner')
  const db = await createAdapter({ ...config, engine })
  try {
    return await createInspector({ db, engine })
  } catch (err) {
    try {
      await db.close()
    } catch {}
    throw err
  }
}
