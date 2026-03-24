import type { TagContext } from '@sqldoc/core'
import { describe, expect, it } from 'vitest'
import plugin from '../index'

const mockAtlasTable = {
  name: 'orders',
  columns: [
    { name: 'id', type: { T: 'integer' } },
    { name: 'total', type: { T: 'numeric' } },
    { name: 'status', type: { T: 'text' } },
  ],
}

function makeCtx(overrides: Partial<TagContext> = {}): TagContext {
  return {
    dialect: 'postgres',
    target: 'table',
    objectName: 'users',
    tag: { name: '$self', args: {} },
    namespaceTags: [],
    siblingTags: [],
    fileTags: [],
    astNode: null,
    fileStatements: [],
    config: { dialect: 'postgres' },
    filePath: 'test.sql',
    ...overrides,
  }
}

describe('ns-audit plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "audit"', () => {
    expect(plugin.name).toBe('audit')
  })

  it('has $self and redact tag definitions', () => {
    expect(plugin.tags).toHaveProperty('$self')
    expect(plugin.tags).toHaveProperty('redact')
  })

  describe('onTag - Postgres', () => {
    it('@audit produces table + function + trigger (all ops by default)', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(3)

      expect(sql[0].sql).toContain('CREATE TABLE IF NOT EXISTS "orders_audit_log"')
      expect(sql[0].sql).toContain('BIGSERIAL')
      expect(sql[0].sql).toContain('JSONB')
      expect(sql[0].sql).toContain('TIMESTAMPTZ')
      expect(sql[1].sql).toContain('CREATE OR REPLACE FUNCTION "orders_audit_fn"()')
      expect(sql[1].sql).toContain('INSERT INTO "orders_audit_log"')
      expect(sql[2].sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON "orders"')
    })

    it('@audit(on: [update, delete]) uses specific operations', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'postgres',
          objectName: 'products',
          tag: { name: null, args: { on: ['update', 'delete'] } },
        }),
      )
      const sql = (result as any).sql

      expect(sql[2].sql).toContain('AFTER UPDATE OR DELETE ON "products"')
      expect(sql[2].sql).not.toContain('INSERT')
    })

    it('@audit(on: [insert]) handles NULL OLD', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'postgres',
          objectName: 'events',
          tag: { name: null, args: { on: ['insert'] } },
        }),
      )
      const sql = (result as any).sql

      expect(sql[1].sql).toContain("CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD) END")
    })

    it('@audit(on: [delete]) handles NULL NEW', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'postgres',
          objectName: 'events',
          tag: { name: null, args: { on: ['delete'] } },
        }),
      )
      const sql = (result as any).sql

      expect(sql[1].sql).toContain("CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW) END")
    })

    it('defaults destination to {objectName}_audit_log', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'postgres',
          objectName: 'users',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql

      expect(sql[0].sql).toContain('CREATE TABLE IF NOT EXISTS "users_audit_log"')
      expect(sql[1].sql).toContain('INSERT INTO "users_audit_log"')
    })

    it('uses explicit destination', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'postgres',
          objectName: 'users',
          tag: { name: null, args: { destination: 'custom_log' } },
        }),
      )
      const sql = (result as any).sql

      expect(sql[0].sql).toContain('CREATE TABLE IF NOT EXISTS "custom_log"')
    })

    it('@audit.redact produces no SQL', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'postgres',
          target: 'column',
          tag: { name: 'redact', args: { strategy: 'hash' } },
        }),
      )
      expect(result).toBeUndefined()
    })
  })

  describe('onTag - MySQL', () => {
    it('produces audit log table with BIGINT AUTO_INCREMENT, JSON, TIMESTAMP', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          atlasTable: mockAtlasTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[0].sql).toContain('BIGINT AUTO_INCREMENT')
      expect(sql[0].sql).toContain('JSON')
      expect(sql[0].sql).toContain('TIMESTAMP')
      expect(sql[0].sql).toContain('NOW()')
    })

    it('produces separate triggers (not multi-event)', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          atlasTable: mockAtlasTable,
        }),
      )
      const sql = (result as any).sql
      // Audit table + 3 separate triggers (INSERT, UPDATE, DELETE)
      expect(sql).toHaveLength(4)
      expect(sql[1].sql).toContain('AFTER INSERT ON')
      expect(sql[2].sql).toContain('AFTER UPDATE ON')
      expect(sql[3].sql).toContain('AFTER DELETE ON')
      // No multi-event trigger
      expect(sql.every((s: any) => !s.sql.includes('INSERT OR UPDATE'))).toBe(true)
    })

    it('trigger bodies contain JSON_OBJECT with explicit columns', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          atlasTable: mockAtlasTable,
        }),
      )
      const sql = (result as any).sql
      // INSERT trigger should have JSON_OBJECT with NEW columns
      expect(sql[1].sql).toContain('JSON_OBJECT')
      expect(sql[1].sql).toContain("'id'")
      expect(sql[1].sql).toContain('NEW.`id`')
      expect(sql[1].sql).toContain("'total'")
      expect(sql[1].sql).toContain('NEW.`total`')
      expect(sql[1].sql).toContain("'status'")
      expect(sql[1].sql).toContain('NEW.`status`')
    })

    it('INSERT trigger has NULL for old_data', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          atlasTable: mockAtlasTable,
        }),
      )
      const sql = (result as any).sql
      // INSERT trigger: old_data is NULL
      expect(sql[1].sql).toMatch(/NULL,\s*JSON_OBJECT/)
    })

    it('DELETE trigger has NULL for new_data', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          atlasTable: mockAtlasTable,
        }),
      )
      const sql = (result as any).sql
      // DELETE trigger: new_data is NULL
      expect(sql[3].sql).toMatch(/JSON_OBJECT\([^)]+\),\s*NULL/)
    })

    it('trigger names follow pattern: objectName_audit_after_op', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          atlasTable: mockAtlasTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[1].sql).toContain('`orders_audit_after_insert`')
      expect(sql[2].sql).toContain('`orders_audit_after_update`')
      expect(sql[3].sql).toContain('`orders_audit_after_delete`')
    })

    it('respects on: [insert, update] (only specified events)', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: { on: ['insert', 'update'] } },
          atlasTable: mockAtlasTable,
        }),
      )
      const sql = (result as any).sql
      // Audit table + 2 triggers
      expect(sql).toHaveLength(3)
      expect(sql[1].sql).toContain('AFTER INSERT ON')
      expect(sql[2].sql).toContain('AFTER UPDATE ON')
    })

    it('without atlasTable generates only audit table and annotation', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      // Only audit table DDL, no triggers
      expect(sql).toHaveLength(1)
      expect(sql[0].sql).toContain('CREATE TABLE IF NOT EXISTS')
      // Should have annotation about needing Tier 2
      const docs = (result as any).docs
      expect(docs.annotations.some((a: any) => a.text.includes('Tier 2'))).toBe(true)
    })
  })

  describe('onTag - SQLite', () => {
    it('produces audit log table with INTEGER, TEXT, TEXT', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'sqlite',
          objectName: 'orders',
          tag: { name: null, args: {} },
          atlasTable: mockAtlasTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[0].sql).toContain('INTEGER')
      expect(sql[0].sql).not.toContain('BIGSERIAL')
      expect(sql[0].sql).not.toContain('BIGINT AUTO_INCREMENT')
      // JSON and timestamp columns should be TEXT for SQLite
      expect(sql[0].sql).toContain("datetime('now')")
    })

    it('produces separate triggers with json_object (lowercase)', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'sqlite',
          objectName: 'orders',
          tag: { name: null, args: {} },
          atlasTable: mockAtlasTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(4)
      // Must use lowercase json_object, not JSON_OBJECT
      expect(sql[1].sql).toContain('json_object')
      expect(sql[1].sql).not.toContain('JSON_OBJECT')
    })

    it("uses datetime('now') for timestamp in triggers", () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'sqlite',
          objectName: 'orders',
          tag: { name: null, args: {} },
          atlasTable: mockAtlasTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[1].sql).toContain("datetime('now')")
    })

    it('uses double-quoted identifiers', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'sqlite',
          objectName: 'orders',
          tag: { name: null, args: {} },
          atlasTable: mockAtlasTable,
        }),
      )
      const sql = (result as any).sql
      // SQLite uses double quotes, not backticks
      expect(sql[1].sql).toContain('NEW."id"')
      expect(sql[1].sql).toContain('"orders_audit_after_insert"')
    })

    it('without atlasTable generates only audit table and annotation', () => {
      const result = plugin.onTag!(
        makeCtx({
          dialect: 'sqlite',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(1)
      expect(sql[0].sql).toContain('CREATE TABLE IF NOT EXISTS')
      const docs = (result as any).docs
      expect(docs.annotations.some((a: any) => a.text.includes('Tier 2'))).toBe(true)
    })
  })

  describe('validation', () => {
    it('@audit.redact without @audit errors', () => {
      const result = plugin.tags!.redact.validate!({
        target: 'column',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: { strategy: 'hash' },
        objectName: 'users',
      })
      expect(result).toBe('@audit.redact requires @audit on the same table')
    })

    it('@audit.redact with @audit passes', () => {
      const result = plugin.tags!.redact.validate!({
        target: 'column',
        lines: [],
        siblingTags: [{ namespace: 'audit', tag: null, rawArgs: null }],
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [{ namespace: 'audit', tag: null, rawArgs: null }],
          },
        ],
        argValues: { strategy: 'hash' },
        objectName: 'users',
      })
      expect(result).toBeUndefined()
    })
  })
})
