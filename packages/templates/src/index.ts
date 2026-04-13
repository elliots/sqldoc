// Type mappers

export type {
  EnrichedColumn,
  EnrichedEnum,
  EnrichedFunction,
  EnrichedSchema,
  EnrichedTable,
  EnrichedView,
  Relation,
  TagEntry,
} from './helpers/enrich.ts'
// Enrichment layer
export { activeTables, enrichRealm, findTagsByNamespace, getNamedArg, getTagArg } from './helpers/enrich.ts'
// Naming helpers
export { toCamelCase, toPascalCase, toScreamingSnake } from './helpers/naming.ts'
// Realm helpers
export { findTagsForObject, getColumnType, getTablesFromRealm, getViewsFromRealm, isNullable } from './helpers/realm.ts'
// Tag lookup helpers
export { findRename, findTypeOverride, isSkipped } from './helpers/tags.ts'
// Tag functions (re-exported for convenience)
export { csharp, dedent, go, java, kotlin, python, rust, sql, ts } from './tags/index.ts'
export type { TsTypeOptions } from './types/index.ts'
export {
  pgToCsharp,
  pgToGo,
  pgToJava,
  pgToKotlin,
  pgToPhp,
  pgToPython,
  pgToRuby,
  pgToRust,
  pgToSwift,
  pgToTs,
} from './types/index.ts'
