// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/postgres/crdb_oss.go

import type { DatabaseAdapter } from '../adapter.ts'
import type { InspectOptions, InspectRealmOption } from '../schema/inspect.ts'
import type { Attr, Column, Index, Realm, Schema, Table } from '../schema/schema.ts'
import type { Change } from '../schema/migrate.ts'
import type { DiffOptions } from '../schema/inspect.ts'
import { PostgresInspector } from './inspect.ts'
import { PostgresDiff } from './diff.ts'
import {
  TypeBigInt,
  TypeInt,
  TypeInt8,
  TypeInt64,
  TypeInteger,
  TypeInt2,
  TypeSmallInt,
  TypeJSON,
  TypeJSONB,
} from './driver.ts'

// -- Helper: find attribute by kind --

function findAttr<T extends Attr>(attrs: Attr[] | undefined, kind: string): T | undefined {
  if (!attrs) return undefined
  return attrs.find((a) => 'kind' in a && (a as any).kind === kind) as T | undefined
}

// -- CockroachDB Inspector --

/**
 * CockroachDB inspector -- patches PostgreSQL inspection for CRDB-specific differences.
 * CockroachDB has several behavioral differences from standard PostgreSQL:
 * - Identity column defaults are handled differently
 * - All serial types are implemented as bigint
 * - Integer types are aliased differently
 * - JSON is aliased to JSONB
 */
export class CrdbInspector extends PostgresInspector {
  constructor(db: DatabaseAdapter) {
    super(db)
  }

  /** Inspect a single schema, applying CRDB-specific patches. */
  async inspectSchema(name: string, opts?: InspectOptions): Promise<Schema> {
    const schema = await super.inspectSchema(name, opts)
    this.patchSchema(schema)
    return schema
  }

  /** Inspect the entire realm, applying CRDB-specific patches to each schema. */
  async inspectRealm(opts?: InspectRealmOption): Promise<Realm> {
    const realm = await super.inspectRealm(opts)
    for (const schema of realm.schemas) {
      this.patchSchema(schema)
    }
    return realm
  }

  /**
   * Patch schema for CockroachDB-specific differences.
   * Fixes: https://github.com/cockroachdb/cockroach/issues/82040
   *
   * - Identity columns: normalize generation to ALWAYS or BY DEFAULT,
   *   and clear the default value (CRDB sets it automatically)
   * - Serial types: convert to bigint equivalent
   */
  patchSchema(schema: Schema): void {
    for (const table of schema.tables ?? []) {
      for (const col of table.columns) {
        const identity = findAttr<{ kind: 'identity'; generation: string }>(col.attrs, 'identity')
        if (identity) {
          // Clear default for identity columns (CRDB adds unique_rowid())
          col.default = undefined
          // Normalize generation string
          const gen = (identity.generation ?? '').toUpperCase()
          if (gen.includes('ALWAYS')) {
            identity.generation = 'ALWAYS'
          } else if (gen.includes('BY DEFAULT')) {
            identity.generation = 'BY DEFAULT'
          }
        }
      }
    }
  }
}

// -- CockroachDB Diff --

/**
 * CockroachDB diff -- patches PostgreSQL diff for CRDB-specific differences.
 * - Serial types are all implemented as bigint
 * - Integer type aliases differ from standard Postgres
 * - JSON is aliased to JSONB
 */
export class CrdbDiff extends PostgresDiff {
  constructor(schemaName?: string) {
    super(schemaName)
  }

  /**
   * Override column change to handle CRDB-specific serial type behavior.
   * All serial types in CockroachDB are implemented as bigint.
   */
  columnChange(
    fromTable: Table,
    from: Column,
    to: Column,
    opts?: DiffOptions,
  ): import('../schema/migrate.ts').Change | undefined {
    // Normalize serial types to bigint for comparison
    const fromNorm = this.normalizeCrdbColumn(from)
    const toNorm = this.normalizeCrdbColumn(to)
    return super.columnChange(fromTable, fromNorm, toNorm, opts)
  }

  /** Normalize a table before diffing -- applies CRDB-specific normalizations. */
  normalize(table: Table): void {
    // CockroachDB adds an implicit primary key on "rowid" if none defined
    if (!table.primaryKey) {
      const rowid = table.columns.find((c) => c.name === 'rowid')
      if (!rowid) {
        table.columns.push({
          name: 'rowid',
          type: { type: { kind: 'integer', T: TypeBigInt }, null: false },
          default: { X: 'unique_rowid()' },
          attrs: [{ kind: 'identity' } as any],
        })
      }
      table.primaryKey = {
        name: 'primary',
        unique: true,
        parts: [{ column: 'rowid' }],
      }
    }

    for (const col of table.columns) {
      const identity = findAttr<{ kind: 'identity' }>(col.attrs, 'identity')
      if (identity && col.default !== undefined) {
        col.default = undefined
      }

      const colType = col.type.type
      if (!colType) continue

      switch (colType.kind) {
        case 'integer': {
          // CockroachDB integer type aliases:
          // bigint, integer, int8, int64, int -> bigint
          // int2, smallint -> smallint
          const lower = colType.T.toLowerCase()
          if ([TypeBigInt, TypeInteger, TypeInt8, TypeInt64, TypeInt].includes(lower)) {
            colType.T = TypeBigInt
          } else if ([TypeInt2, TypeSmallInt].includes(lower)) {
            colType.T = TypeSmallInt
          }
          break
        }

        case 'json': {
          // JSON is aliased to JSONB in CockroachDB
          if (colType.T.toLowerCase() === TypeJSON) {
            colType.T = TypeJSONB
          }
          break
        }

        case 'serial': {
          // Serial types become bigint with unique_rowid() default
          col.type.type = { kind: 'integer', T: TypeBigInt }
          col.default = { X: 'unique_rowid()' }
          break
        }

        case 'time': {
          // Normalize timestamp aliases
          const lower = colType.T.toLowerCase()
          switch (lower) {
            case 'timestamp with time zone':
              colType.T = 'timestamptz'
              break
            case 'timestamp without time zone':
              colType.T = 'timestamp'
              break
          }
          break
        }

        case 'float': {
          // Normalize float precision
          const prec = (colType as any).precision ?? 0
          const lower = colType.T.toLowerCase()
          if (lower === 'float' && prec < 25) {
            colType.T = 'real'
            ;(colType as any).precision = 24
          } else if (lower === 'real') {
            ;(colType as any).precision = 24
          } else if (lower === 'float' && prec >= 25) {
            colType.T = 'double precision'
            ;(colType as any).precision = 53
          } else if (lower === 'double precision') {
            ;(colType as any).precision = 53
          }
          break
        }

        case 'string': {
          // Character without length specifier is equivalent to character(1)
          const lower = colType.T.toLowerCase()
          if (lower === 'character' || lower === 'char') {
            ;(colType as any).size = 1
          }
          break
        }
      }
    }
  }

  /** Normalize a column for CRDB comparison by converting serial -> bigint. */
  private normalizeCrdbColumn(col: Column): Column {
    if (col.type.type?.kind === 'serial') {
      return {
        ...col,
        type: {
          ...col.type,
          type: { kind: 'integer', T: TypeBigInt },
        },
        default: undefined,
      }
    }
    return col
  }
}
