// ── Arg type primitives ──────────────────────────────────────────────

export type StringType = { type: 'string'; description?: string }
export type NumberType = { type: 'number'; description?: string }
export type BooleanType = { type: 'boolean'; description?: string }
export type EnumType<V extends string = string> = { type: 'enum'; values: readonly V[]; description?: string }
export type ArgType = StringType | NumberType | BooleanType | EnumType | ArrayType<any>
export type ArrayType<U extends ArgType> = { type: 'array'; items: U; description?: string }

// ── Type inference from schema definitions ──────────────────────────

/** Infer the TypeScript type from a single ArgType schema field */
export type InferArgType<T extends ArgType> = T extends { type: 'string' }
  ? string
  : T extends { type: 'number' }
    ? number
    : T extends { type: 'boolean' }
      ? boolean
      : T extends { type: 'enum'; values: readonly (infer V)[] }
        ? V
        : T extends { type: 'array'; items: infer U extends ArgType }
          ? InferArgType<U>[]
          : never

/** Infer a full config/args object type from a schema definition used with `as const` */
export type InferSchema<T extends Record<string, ArgType>> = {
  [K in keyof T]?: InferArgType<T[K]>
}

// ── Tag arg shapes ───────────────────────────────────────────────────

/** Tag takes no arguments: `@audit.tracked` */
export interface NoArgs {
  args?: undefined
}

/** Tag takes positional (unnamed) arguments: `@gql.order(asc)` */
export interface PositionalArgs {
  args: ArgType[]
}

/** Tag takes named properties: `@audit.log(on: [...], destination: '...')` */
export interface NamedArgs {
  args: Record<string, ArgType & { required?: boolean }>
}

export type TagArgs = NoArgs | PositionalArgs | NamedArgs

// ── Tag definition ───────────────────────────────────────────────────

export type SqlTarget = 'table' | 'column' | 'function' | 'view' | 'index' | 'type' | 'trigger' | 'unknown'

export type ValidationContext = {
  /** What kind of SQL construct this tag is attached to */
  target: SqlTarget
  /** The raw SQL lines this tag is attached to (the non-comment lines following the tag comments) */
  lines: string[]
  /** Other tags on the same target (siblings in the same comment block) */
  siblingTags: { namespace: string; tag: string | null; rawArgs: string | null }[]
  /** All tags across the entire file, grouped by SQL object */
  fileTags: Array<{
    objectName: string
    target: SqlTarget
    tags: { namespace: string; tag: string | null; rawArgs: string | null }[]
  }>
  /** Parsed argument values */
  argValues: Record<string, unknown> | unknown[]
  /** Column name (when target is 'column') */
  columnName?: string
  /** Column type (when target is 'column'), e.g. "text", "bigserial" */
  columnType?: string
  /** Table/view/type/function name */
  objectName?: string
  /** The raw AST node from the SQL parser, for advanced validation */
  astNode?: unknown
}

export type TagDef = TagArgs & {
  description?: string
  /** Which SQL targets this tag can be placed on. If omitted, allowed on any target. */
  targets?: SqlTarget[]
  validate?: (
    ctx: ValidationContext,
  ) => string | { message: string; severity?: 'error' | 'warning' | 'info' } | undefined
}

// ── Namespace definition ─────────────────────────────────────────────

/**
 * A namespace is a collection of tags.
 * Use `$self` for when the namespace name is used as a standalone tag
 * (e.g. `@searchable` where `searchable` is also a namespace for `@searchable.fulltext`).
 */
export type NamespaceDef = {
  $self?: TagDef
} & {
  [tagName: string]: TagDef
}

// ── Top-level export shape ───────────────────────────────────────────

/**
 * Each tag definition file exports a single namespace.
 * The SQL file imports it:
 *   -- @import './audit.ts'
 *   -- @import '@elliots/sqldoc/gql'
 */
export type TagNamespace = {
  name: string
  tags: NamespaceDef
}
