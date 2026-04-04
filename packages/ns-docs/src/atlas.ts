/**
 * Atlas integration for ns-docs.
 *
 * BEFORE (Phase 6): Used execFileSync to shell out to Atlas CLI.
 * AFTER (Phase 7): Atlas WASI inspect is run by the CLI compile command.
 * The afterCompile hook receives the already-inspected schema.
 *
 * This module now provides conversion utilities from Atlas WASI types
 * to the ns-docs internal types used by merge.ts and renderers.
 */
import type { AtlasRealm } from '@sqldoc/db'
import type { AtlasSchema } from './types.ts'

/** Convert Atlas WASI realm to ns-docs AtlasSchema format */
export function realmToDocsSchema(realm: AtlasRealm): AtlasSchema {
  // Map from lowercase Atlas WASI types to ns-docs internal types
  return {
    schemas: realm.schemas.map((s) => ({
      name: s.name,
      tables: (s.tables ?? []).map((t) => ({
        name: t.name,
        columns: (t.columns ?? [])
          .filter((c) => c.name != null)
          .map((c) => ({
            name: c.name!,
            type: c.type?.raw ?? c.type?.T ?? 'unknown',
            null: c.type?.null,
          })),
        indexes: (t.indexes ?? []).map((idx) => ({
          name: idx.name ?? '',
          unique: idx.unique,
          parts: (idx.parts ?? []).map((p) => ({ column: p.column ?? '' })),
        })),
        primary_key: t.primary_key
          ? {
              parts: (t.primary_key.parts ?? []).map((p) => ({ column: p.column ?? '' })),
            }
          : undefined,
        foreign_keys: (t.foreign_keys ?? []).map((fk) => ({
          name: fk.symbol ?? '',
          columns: fk.columns ?? [],
          references: {
            table: fk.ref_table ?? '',
            columns: fk.ref_columns ?? [],
          },
        })),
      })),
      views: (s.views ?? []).map((v) => ({
        name: v.name,
        columns: (v.columns ?? [])
          .filter((c) => c.name != null)
          .map((c) => ({
            name: c.name!,
            type: c.type?.raw ?? c.type?.T ?? 'unknown',
            null: c.type?.null,
          })),
      })),
    })),
  }
}
