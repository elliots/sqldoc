import { makeTagCtx } from '@sqldoc/core/test'
import { describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

const mockSchemaTable = {
  name: 'orders',
  columns: [
    { name: 'id', type: { type: { kind: 'integer', T: 'integer' }, raw: 'integer', null: false } },
    { name: 'total', type: { type: { kind: 'decimal', T: 'numeric(10,2)' }, raw: 'numeric(10,2)', null: false } },
    { name: 'status', type: { type: { kind: 'string', T: 'text' }, raw: 'text', null: true } },
  ],
}

describe('ns-history plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "history"', () => {
    expect(plugin.name).toBe('history')
  })

  it('has $self tag definition', () => {
    expect('$self' in plugin.tags).toBeTruthy()
  })

  describe('onTag - Postgres', () => {
    it('@history produces history table + function + trigger (all ops by default)', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(3)

      // History table DDL
      expect(sql[0].sql).toContain('CREATE TABLE IF NOT EXISTS "orders_history"')
      expect(sql[0].sql).toContain('history_id')
      expect(sql[0].sql).toContain('BIGSERIAL')
      expect(sql[0].sql).toContain('"id" integer NOT NULL')
      expect(sql[0].sql).toContain('"total" numeric(10,2) NOT NULL')
      expect(sql[0].sql).toContain('"status" text')
      expect(sql[0].sql).toContain('valid_from')
      expect(sql[0].sql).toContain('valid_to')
      expect(sql[0].sql).toContain('history_operation')

      // PL/pgSQL function
      expect(sql[1].sql).toContain('CREATE OR REPLACE FUNCTION "orders_history_fn"()')
      expect(sql[1].sql).toContain('INSERT INTO "orders_history"')
      expect(sql[1].sql).toContain('OLD."id"')
      expect(sql[1].sql).toContain('OLD."total"')
      expect(sql[1].sql).toContain('TG_OP')

      // Multi-event trigger
      expect(sql[2].sql).toContain('BEFORE UPDATE OR DELETE ON "orders"')
    })

    it('@history(on: [delete]) uses specific operations', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'products',
          tag: { name: null, args: { on: ['delete'] } },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[2].sql).toContain('BEFORE DELETE ON "products"')
      expect(sql[2].sql).not.toContain('UPDATE')
    })

    it('uses custom destination', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: { destination: 'audit_history' } },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[0].sql).toContain('CREATE TABLE IF NOT EXISTS "audit_history"')
      expect(sql[1].sql).toContain('INSERT INTO "audit_history"')
    })

    it('returns docs metadata', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const docs = (result as any).docs
      expect(docs.relationships).toHaveLength(1)
      expect(docs.relationships[0].from).toBe('orders')
      expect(docs.relationships[0].to).toBe('orders_history')
      expect(docs.relationships[0].style).toBe('dashed')
      expect(docs.annotations[0].text).toContain('History tracked')
    })

    it('without schemaTable emits only annotation', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(0)
      const docs = (result as any).docs
      expect(docs.annotations.some((a: any) => a.text.includes('Tier 2'))).toBe(true)
    })
  })

  describe('onTag - MySQL', () => {
    it('produces history table with BIGINT AUTO_INCREMENT', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[0].sql).toContain('BIGINT AUTO_INCREMENT')
      expect(sql[0].sql).toContain('TIMESTAMP')
      expect(sql[0].sql).toContain('NOW()')
    })

    it('produces separate per-event BEFORE triggers', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      // History table + 2 triggers (update + delete)
      expect(sql).toHaveLength(3)
      expect(sql[1].sql).toContain('BEFORE UPDATE ON')
      expect(sql[2].sql).toContain('BEFORE DELETE ON')
    })

    it('trigger names follow pattern: objectName_history_before_op', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[1].sql).toContain('`orders_history_before_update`')
      expect(sql[2].sql).toContain('`orders_history_before_delete`')
    })

    it('trigger bodies contain explicit OLD column references', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[1].sql).toContain('OLD.`id`')
      expect(sql[1].sql).toContain('OLD.`total`')
      expect(sql[1].sql).toContain('OLD.`status`')
    })

    it('respects on: [update] (only specified events)', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: { on: ['update'] } },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      // History table + 1 trigger
      expect(sql).toHaveLength(2)
      expect(sql[1].sql).toContain('BEFORE UPDATE ON')
    })

    it('without schemaTable emits only annotation', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(0)
      const docs = (result as any).docs
      expect(docs.annotations.some((a: any) => a.text.includes('Tier 2'))).toBe(true)
    })
  })

  describe('onTag - SQLite', () => {
    it('produces history table with INTEGER primary key', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'sqlite',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[0].sql).toContain('INTEGER')
      expect(sql[0].sql).not.toContain('BIGSERIAL')
      expect(sql[0].sql).toContain("datetime('now')")
    })

    it('uses double-quoted identifiers in triggers', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'sqlite',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[1].sql).toContain('"orders_history_before_update"')
      expect(sql[1].sql).toContain('OLD."id"')
    })

    it('without schemaTable emits only annotation', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'sqlite',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(0)
      const docs = (result as any).docs
      expect(docs.annotations.some((a: any) => a.text.includes('Tier 2'))).toBe(true)
    })
  })

  describe('lint rules', () => {
    it('has history.require-history rule', () => {
      expect(plugin.lintRules).toHaveLength(1)
      expect(plugin.lintRules![0].name).toBe('history.require-history')
    })
  })
})
