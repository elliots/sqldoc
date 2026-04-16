// @sqldoc/db -- Database adapters and schema types for sqldoc
// Schema types are re-exported from @sqldoc/inspector.

import type { DatabaseEngine } from '@sqldoc/core'
import { defaultDevUrlForEngine, getEngineSpec, resolveDatabaseEngine } from '@sqldoc/core'
import type { DatabaseAdapter, DbSource, InspectorRunner } from '@sqldoc/inspector'
import { createContainerDbSource } from './db/dbsource-container.ts'
import { createMemoryDbSource } from './db/dbsource-memory.ts'
import { createServerDbSource } from './db/dbsource-server.ts'
import type { OnMissingPlugin } from './db/plugin-resolver.ts'
import { resolveAdapterPlugin } from './db/plugin-resolver.ts'
import type { AdapterPluginContext, DatabaseAdapterPlugin, Dialect } from './db/types.ts'
import { validatePostgresExtensions } from './extensions.ts'

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
  // DbSource interface
  DbSource,
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
export { createContainerDbSource } from './db/dbsource-container.ts'
export { createMemoryDbSource } from './db/dbsource-memory.ts'
export { createServerDbSource } from './db/dbsource-server.ts'
export type { OnMissingPlugin } from './db/plugin-resolver.ts'
export { extractScheme, registerBuiltin, resolveAdapterPlugin, schemeToPackage } from './db/plugin-resolver.ts'
export { createSqliteAdapter } from './db/sqlite.ts'
export type {
  AdapterPluginContext,
  DatabaseAdapterPlugin,
  Dialect,
} from './db/types.ts'
export { createBunSqlAdapter, isBun, normalizeValue } from './db/types.ts'
export { extractExtensions, validatePostgresExtensions } from './extensions.ts'

export interface CreateRunnerConfig {
  engine: DatabaseEngine
  devUrl?: string
  extensions?: string[]
  sqldocDir?: string
  onMissingPlugin?: OnMissingPlugin
  adapterPlugin?: DatabaseAdapterPlugin
}

// ── Dialect helpers ───────────────────────────────────────────────

interface DialectSourceRuntime {
  createContext(dialect: Dialect, config: CreateRunnerConfig): AdapterPluginContext
  validateSource?: (source: DbSource, context: AdapterPluginContext) => Promise<void>
}

const DIALECT_SOURCE_RUNTIMES: Record<Dialect, DialectSourceRuntime> = {
  postgres: {
    createContext: (_dialect, config) => ({ dialect: 'postgres', extensions: config.extensions ?? [] }),
    validateSource: async (source, context) => {
      if (context.extensions.length === 0) return
      if (process.env.DEBUG) console.error(`[runner] validating extensions: ${context.extensions.join(', ')}`)
      const db = await source.open()
      try {
        await validatePostgresExtensions(context.extensions, (sql) => db.query(sql))
      } finally {
        await db.close()
      }
      if (process.env.DEBUG) console.error('[runner] extensions validated')
    },
  },
  mysql: {
    createContext: () => ({ dialect: 'mysql', extensions: [] }),
  },
  sqlite: {
    createContext: () => ({ dialect: 'sqlite', extensions: [] }),
  },
  mssql: {
    createContext: () => ({ dialect: 'mssql', extensions: [] }),
  },
}

function getEngineSourceRuntime(engine: DatabaseEngine): DialectSourceRuntime & { dialect: Dialect } {
  const dialect = getEngineSpec(engine).dialect
  return { dialect, ...DIALECT_SOURCE_RUNTIMES[dialect] }
}

function isDockerDevUrl(devUrl: string): boolean {
  return devUrl.startsWith('docker://') || devUrl.startsWith('dockerfile://')
}

function isServerDevUrl(devUrl: string): boolean {
  return /^(postgres|postgresql|mysql|mssql):\/\//.test(devUrl)
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Create a single DatabaseAdapter from config. For in-memory and direct URLs
 * this is a thin wrapper around the plugin resolver. For docker/dockerfile
 * URLs it creates an ephemeral shadow DB; closing the returned adapter
 * disposes the shadow AND stops the container.
 *
 * Mostly useful for one-off adapter usage (drift check, tests). If you're
 * going to run multiple operations, prefer createDbSource() / createRunner().
 */
export async function createAdapter(config: CreateRunnerConfig): Promise<DatabaseAdapter> {
  const engine = resolveDatabaseEngine(config, 'createAdapter')
  const runtime = getEngineSourceRuntime(engine)
  const devUrl = config.devUrl ?? defaultDevUrlForEngine(engine)
  const context = runtime.createContext(runtime.dialect, config)

  if (isDockerDevUrl(devUrl) || isServerDevUrl(devUrl)) {
    const source = await createDbSource({ ...config, engine })
    const db = await source.open()
    const originalClose = db.close.bind(db)
    return {
      currentSchema: db.currentSchema,
      query: db.query.bind(db),
      exec: db.exec.bind(db),
      async close() {
        try {
          await originalClose()
        } finally {
          await source.close()
        }
      },
    }
  }

  return resolveAdapterPlugin({
    devUrl,
    context,
    sqldocDir: config.sqldocDir,
    onMissingPlugin: config.onMissingPlugin,
    adapterPlugin: config.adapterPlugin,
  })
}

/**
 * Create a DbSource from config. Each open() returns a fresh empty database.
 * - pglite/sqlite/:memory: → new in-memory instance per open
 * - docker/dockerfile URLs → one container, CREATE/DROP DATABASE per open
 * - server URLs (postgres://, mysql://, mssql://) → CREATE/DROP DATABASE per open
 */
export async function createDbSource(config: CreateRunnerConfig): Promise<DbSource> {
  const engine = resolveDatabaseEngine(config, 'createDbSource')
  const runtime = getEngineSourceRuntime(engine)
  const devUrl = config.devUrl ?? defaultDevUrlForEngine(engine)
  const context = runtime.createContext(runtime.dialect, config)
  const pluginOpts = {
    context,
    sqldocDir: config.sqldocDir,
    onMissingPlugin: config.onMissingPlugin,
    adapterPlugin: config.adapterPlugin,
  }

  let source: DbSource

  if (isDockerDevUrl(devUrl)) {
    source = await createContainerDbSource({ devUrl, ...pluginOpts })
  } else if (isServerDevUrl(devUrl)) {
    source = await createServerDbSource({ devUrl, ...pluginOpts })
  } else {
    source = createMemoryDbSource({ devUrl, ...pluginOpts })
  }

  if (runtime.validateSource) {
    try {
      await runtime.validateSource(source, context)
    } catch (err) {
      try {
        await source.close()
      } catch {}
      throw err
    }
  }

  return source
}

/**
 * Create an InspectorRunner from config. Convenience wrapper around
 * createDbSource() + createInspector().
 */
export async function createRunner(config: CreateRunnerConfig): Promise<InspectorRunner> {
  const { createInspector } = await import('@sqldoc/inspector')
  const engine = resolveDatabaseEngine(config, 'createRunner')
  const source = await createDbSource({ ...config, engine })
  try {
    return await createInspector({ source, engine })
  } catch (err) {
    try {
      await source.close()
    } catch {}
    throw err
  }
}
