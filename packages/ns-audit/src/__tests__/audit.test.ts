import type { TagContext } from '@sqldoc/core'
import { describe, expect, it } from 'vitest'
import plugin from '../index'

function makeCtx(overrides: Partial<TagContext> = {}): TagContext {
  return {
    target: 'table',
    objectName: 'users',
    tag: { name: '$self', args: {} },
    namespaceTags: [],
    siblingTags: [],
    fileTags: [],
    astNode: null,
    fileStatements: [],
    config: {},
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

  describe('onTag', () => {
    it('@audit produces table + function + trigger (all ops by default)', () => {
      const result = plugin.onTag!(
        makeCtx({
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(3)

      expect(sql[0].sql).toContain('CREATE TABLE IF NOT EXISTS "orders_audit_log"')
      expect(sql[1].sql).toContain('CREATE OR REPLACE FUNCTION "orders_audit_fn"()')
      expect(sql[1].sql).toContain('INSERT INTO "orders_audit_log"')
      expect(sql[2].sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON "orders"')
    })

    it('@audit(on: [update, delete]) uses specific operations', () => {
      const result = plugin.onTag!(
        makeCtx({
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
          target: 'column',
          tag: { name: 'redact', args: { strategy: 'hash' } },
        }),
      )
      expect(result).toBeUndefined()
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
