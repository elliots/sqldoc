/**
 * Schema integration for ns-docs.
 *
 * Provides conversion utilities from inspector Realm types
 * to the ns-docs internal types used by merge.ts and renderers.
 */
import type { Realm } from '@sqldoc/db'
import type { SchemaSnapshot } from './types.ts'

/** Convert inspector Realm to the docs schema snapshot format */
export function realmToDocsSchema(realm: Realm): SchemaSnapshot {
  return {
    schemas: realm.schemas.map((s) => ({
      name: s.name,
      tables: (s.tables ?? []).map((t) => ({
        name: t.name,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type.raw ?? c.type.type.T ?? 'unknown',
          null: c.type.null,
        })),
        indexes: (t.indexes ?? []).map((idx) => ({
          name: idx.name ?? '',
          unique: idx.unique,
          parts: idx.parts.map((p) => ({ column: p.column ?? '' })),
        })),
        primary_key: t.primaryKey
          ? {
              parts: t.primaryKey.parts.map((p) => ({ column: p.column ?? '' })),
            }
          : undefined,
        foreign_keys: (t.foreignKeys ?? []).map((fk) => ({
          name: fk.symbol ?? '',
          columns: fk.columns,
          references: {
            table: fk.refTable,
            columns: fk.refColumns,
          },
        })),
      })),
      views: (s.views ?? []).map((v) => ({
        name: v.name,
        columns: (v.columns ?? []).map((c) => ({
          name: c.name,
          type: c.type.raw ?? c.type.type.T ?? 'unknown',
          null: c.type.null,
        })),
      })),
    })),
  }
}
