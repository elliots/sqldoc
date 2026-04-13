import { makeTagCtx } from '@sqldoc/core/test'
import { describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

const mockSchemaTable = {
  name: 'orders',
  columns: [
    { name: 'id', type: { T: 'integer' } },
    { name: 'user_id', type: { T: 'bigint' } },
    { name: 'total', type: { T: 'numeric' } },
  ],
  foreign_keys: [
    {
      columns: ['user_id'],
      ref_table: 'users',
      ref_columns: ['id'],
    },
  ],
  primary_key: { columns: ['id'] },
}

describe('ns-softdelete plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "softdelete"', () => {
    expect(plugin.name).toBe('softdelete')
  })

  it('has $self and cascade tag definitions', () => {
    expect('$self' in plugin.tags).toBeTruthy()
    expect('cascade' in plugin.tags).toBeTruthy()
  })

  describe('onTag - Postgres', () => {
    it('@softdelete produces ALTER TABLE + CREATE VIEW', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(2)
      expect(sql[0].sql).toContain('ALTER TABLE "orders" ADD COLUMN "deleted_at"')
      expect(sql[0].sql).toContain('TIMESTAMPTZ')
      expect(sql[1].sql).toContain('CREATE VIEW "orders_active"')
      expect(sql[1].sql).toContain('WHERE "deleted_at" IS NULL')
    })

    it('uses custom column and view names', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'users',
          tag: { name: null, args: { column: 'removed_at', view: 'live_users' } },
        }),
      )
      const sql = (result as any).sql
      expect(sql[0].sql).toContain('"removed_at"')
      expect(sql[1].sql).toContain('"live_users"')
      expect(sql[1].sql).toContain('"removed_at" IS NULL')
    })

    it('returns docs metadata', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const docs = (result as any).docs
      expect(docs.relationships).toHaveLength(1)
      expect(docs.relationships[0].from).toBe('orders')
      expect(docs.relationships[0].to).toBe('orders_active')
      expect(docs.relationships[0].style).toBe('dashed')
      expect(docs.annotations[0].text).toContain('Soft-deletable')
    })

    it('@softdelete.cascade produces function + trigger', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          target: 'column',
          columnName: 'user_id',
          tag: { name: 'cascade', args: {} },
          schemaTable: mockSchemaTable,
          namespaceTags: [{ tag: null, args: {} }],
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(2)
      expect(sql[0].sql).toContain('CREATE OR REPLACE FUNCTION "orders_user_id_softdelete_cascade_fn"()')
      expect(sql[0].sql).toContain('UPDATE "orders" SET "deleted_at"')
      expect(sql[0].sql).toContain('WHERE "user_id" = NEW."id"')
      expect(sql[1].sql).toContain('AFTER UPDATE ON "users"')
    })

    it('@softdelete.cascade without schemaTable emits annotation', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'postgres',
          objectName: 'orders',
          target: 'column',
          columnName: 'user_id',
          tag: { name: 'cascade', args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(0)
      const docs = (result as any).docs
      expect(docs.annotations.some((a: any) => a.text.includes('Tier 2'))).toBe(true)
    })
  })

  describe('onTag - MySQL', () => {
    it('produces ALTER TABLE with TIMESTAMP', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql[0].sql).toContain('TIMESTAMP')
      expect(sql[0].sql).toContain('`orders`')
      expect(sql[0].sql).toContain('`deleted_at`')
    })

    it('produces CREATE VIEW with backtick identifiers', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'mysql',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql[1].sql).toContain('`orders_active`')
      expect(sql[1].sql).toContain('`deleted_at` IS NULL')
    })

    it('@softdelete.cascade produces per-event trigger', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'mysql',
          objectName: 'orders',
          target: 'column',
          columnName: 'user_id',
          tag: { name: 'cascade', args: {} },
          schemaTable: mockSchemaTable,
          namespaceTags: [{ tag: null, args: {} }],
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(1)
      expect(sql[0].sql).toContain('`orders_user_id_softdelete_cascade_after_update`')
      expect(sql[0].sql).toContain('AFTER UPDATE ON `users`')
      expect(sql[0].sql).toContain('UPDATE `orders` SET `deleted_at`')
    })
  })

  describe('onTag - SQLite', () => {
    it('produces ALTER TABLE with TEXT type', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'sqlite',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql[0].sql).toContain('TEXT')
      expect(sql[0].sql).toContain('"orders"')
      expect(sql[0].sql).toContain('"deleted_at"')
    })

    it('produces CREATE VIEW with double-quoted identifiers', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'sqlite',
          objectName: 'orders',
          tag: { name: null, args: {} },
        }),
      )
      const sql = (result as any).sql
      expect(sql[1].sql).toContain('"orders_active"')
      expect(sql[1].sql).toContain('"deleted_at" IS NULL')
    })

    it('@softdelete.cascade produces trigger with double-quoted identifiers', () => {
      const result = plugin.onTag!(
        makeTagCtx({
          dialect: 'sqlite',
          objectName: 'orders',
          target: 'column',
          columnName: 'user_id',
          tag: { name: 'cascade', args: {} },
          schemaTable: mockSchemaTable,
          namespaceTags: [{ tag: null, args: {} }],
        }),
      )
      const sql = (result as any).sql
      expect(sql).toHaveLength(1)
      expect(sql[0].sql).toContain('"orders_user_id_softdelete_cascade_after_update"')
      expect(sql[0].sql).toContain('AFTER UPDATE ON "users"')
    })
  })

  describe('validation', () => {
    it('@softdelete.cascade without @softdelete errors', () => {
      const result = plugin.tags!.cascade.validate!({
        target: 'column',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: {},
        objectName: 'orders',
      })
      expect(result).toBe('@softdelete.cascade requires @softdelete on the same table')
    })

    it('@softdelete.cascade with @softdelete passes', () => {
      const result = plugin.tags!.cascade.validate!({
        target: 'column',
        lines: [],
        siblingTags: [{ namespace: 'softdelete', tag: null, rawArgs: null }],
        fileTags: [
          {
            objectName: 'orders',
            target: 'table',
            tags: [{ namespace: 'softdelete', tag: null, rawArgs: null }],
          },
        ],
        argValues: {},
        objectName: 'orders',
      })
      expect(result).toBe(undefined)
    })
  })

  describe('lint rules', () => {
    it('has softdelete.require-softdelete rule', () => {
      expect(plugin.lintRules).toHaveLength(1)
      expect(plugin.lintRules![0].name).toBe('softdelete.require-softdelete')
    })
  })
})
