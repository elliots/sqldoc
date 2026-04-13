import { makeTagCtx } from '@sqldoc/core/test'
import { describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

const mockSchemaTable = {
  name: 'orders',
  columns: [
    { name: 'id', type: { T: 'integer' } },
    { name: 'total', type: { T: 'numeric' } },
    { name: 'status', type: { T: 'text' } },
  ],
  primary_key: { columns: ['id'] },
}

describe('ns-temporal plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "temporal"', () => {
    expect(plugin.name).toBe('temporal')
  })

  it('has $self tag definition', () => {
    expect('$self' in plugin.tags).toBeTruthy()
  })

  describe('onTag - Postgres', () => {
    it('@temporal produces columns + view + 6 trigger outputs', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      // 2 ALTER TABLE + 1 DROP PK + 1 ADD version_id + 1 VIEW + 6 triggers
      expect(sql).toHaveLength(11)

      // Temporal columns
      expect(sql[0].sql).toContain('ALTER TABLE "orders" ADD COLUMN "valid_from"')
      expect(sql[0].sql).toContain('TIMESTAMPTZ')
      expect(sql[0].sql).toContain('NOT NULL DEFAULT')
      expect(sql[1].sql).toContain('ALTER TABLE "orders" ADD COLUMN "valid_to"')

      // PK alteration
      expect(sql[2].sql).toContain('DROP CONSTRAINT')
      expect(sql[3].sql).toContain('version_id')
      expect(sql[3].sql).toContain('BIGSERIAL PRIMARY KEY')

      // View
      expect(sql[4].sql).toContain('CREATE VIEW "orders_current"')
      expect(sql[4].sql).toContain('"valid_to" IS NULL')
    })

    it('generates INSERT trigger function', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[5].sql).toContain('CREATE OR REPLACE FUNCTION "orders_temporal_insert_fn"()')
      expect(sql[5].sql).toContain('NEW."valid_from" = now()')
      expect(sql[5].sql).toContain('NEW."valid_to" = NULL')
      expect(sql[6].sql).toContain('BEFORE INSERT ON "orders"')
    })

    it('generates UPDATE trigger that archives OLD row', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[7].sql).toContain('CREATE OR REPLACE FUNCTION "orders_temporal_update_fn"()')
      expect(sql[7].sql).toContain('INSERT INTO "orders"')
      expect(sql[7].sql).toContain('OLD."id"')
      expect(sql[7].sql).toContain('OLD."valid_from"')
      expect(sql[8].sql).toContain('BEFORE UPDATE ON "orders"')
      expect(sql[8].sql).toContain('WHEN (OLD."valid_to" IS NULL)')
    })

    it('generates DELETE trigger that cancels delete', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[9].sql).toContain('CREATE OR REPLACE FUNCTION "orders_temporal_delete_fn"()')
      expect(sql[9].sql).toContain('INSERT INTO "orders"')
      expect(sql[9].sql).toContain('OLD."valid_from"')
      expect(sql[9].sql).toContain('RETURN OLD')
      expect(sql[10].sql).toContain('BEFORE DELETE ON "orders"')
    })

    it('uses custom view name', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: { view: 'live_orders' } },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      expect(sql[4].sql).toContain('"live_orders"')
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
      expect(docs.relationships[0].to).toBe('orders_current')
      expect(docs.relationships[0].label).toBe('current view')
      expect(docs.annotations[0].text).toBe('Temporal (SCD Type 2)')
      expect(docs.columns[0].header).toBe('Temporal')
    })

    it('without schemaTable emits columns + view + annotation', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      // 2 ALTER TABLE + 1 VIEW, no triggers
      expect(sql).toHaveLength(3)
      expect(sql[0].sql).toContain('ALTER TABLE')
      expect(sql[2].sql).toContain('CREATE VIEW')
      const docs = (result as any).docs
      expect(docs.annotations.some((a: any) => a.text.includes('Tier 2'))).toBe(true)
    })
  })

  describe('onTag - MySQL', () => {
    it('produces columns + view + INSERT trigger only', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const sql = (result as any).sql
      // 2 ALTER TABLE + 1 VIEW + 1 INSERT trigger (no PK alteration for MySQL)
      expect(sql).toHaveLength(4)
      expect(sql[0].sql).toContain('TIMESTAMP')
      expect(sql[0].sql).toContain('`orders`')
      expect(sql[3].sql).toContain('BEFORE INSERT ON')
      expect(sql[3].sql).toContain('SET NEW.`valid_from` = NOW()')
    })

    it('emits annotation about MySQL limitation', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
          schemaTable: mockSchemaTable,
        }),
      )
      const docs = (result as any).docs
      expect(docs.annotations.some((a: any) => a.text.includes('MySQL does not support'))).toBe(true)
    })
  })

  describe('lint rules', () => {
    it('has temporal.require-temporal rule', () => {
      expect(plugin.lintRules).toHaveLength(1)
      expect(plugin.lintRules![0].name).toBe('temporal.require-temporal')
    })
  })
})
