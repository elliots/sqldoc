import { makeTagCtx } from '@sqldoc/core/test'
import { describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('ns-deprecated plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "deprecated"', () => {
    expect(plugin.name).toBe('deprecated')
  })

  it('has $self, replace, and remove tag entries', () => {
    expect('$self' in plugin.tags).toBeTruthy()
    expect('replace' in plugin.tags).toBeTruthy()
    expect('remove' in plugin.tags).toBeTruthy()
  })

  describe('onTag -- Postgres', () => {
    it('@deprecated on a table generates COMMENT ON TABLE', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS 'DEPRECATED';` }])
    })

    it('@deprecated with null tag name generates COMMENT ON TABLE', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'table',
        objectName: 'users',
        tag: { name: null, args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS 'DEPRECATED';` }])
    })

    it('@deprecated on a column generates COMMENT ON COLUMN with qualified name', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'column',
        objectName: 'users',
        columnName: 'email',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON COLUMN "users"."email" IS 'DEPRECATED';` }])
    })

    it('@deprecated on a view generates COMMENT ON VIEW', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'view',
        objectName: 'active_users',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON VIEW "active_users" IS 'DEPRECATED';` }])
    })

    it('@deprecated on a function generates COMMENT ON FUNCTION', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'function',
        objectName: 'get_user',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON FUNCTION "get_user" IS 'DEPRECATED';` }])
    })

    it('@deprecated on a type generates COMMENT ON TYPE', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'type',
        objectName: 'status_enum',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TYPE "status_enum" IS 'DEPRECATED';` }])
    })

    it('@deprecated.replace generates COMMENT with replacement suggestion', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'table',
        objectName: 'old_users',
        tag: { name: 'replace', args: ['accounts'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "old_users" IS 'DEPRECATED: use accounts instead';` }])
    })

    it('@deprecated.remove generates COMMENT with removal date', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'table',
        objectName: 'legacy_data',
        tag: { name: 'remove', args: ['2025-06-01'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        { sql: `COMMENT ON TABLE "legacy_data" IS 'DEPRECATED: scheduled for removal after 2025-06-01';` },
      ])
    })

    it('@deprecated.replace on a column generates correct qualified COMMENT', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'column',
        objectName: 'users',
        columnName: 'name',
        tag: { name: 'replace', args: ['full_name'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON COLUMN "users"."name" IS 'DEPRECATED: use full_name instead';` }])
    })
  })

  describe('onTag -- MySQL', () => {
    it('@deprecated on a table generates ALTER TABLE COMMENT', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: "ALTER TABLE `users` COMMENT = 'DEPRECATED';" }])
      expect(result.docs).not.toBe(undefined)
    })

    it('@deprecated on a MySQL column returns docs-only (no sql)', () => {
      // MySQL's ALTER TABLE MODIFY COLUMN would strip NOT NULL / DEFAULT / etc.
      // attributes of the column, so we only emit docs output for MySQL columns.
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'column',
        objectName: 'users',
        columnName: 'email',
        columnType: 'VARCHAR(255)',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([])
      expect(result.docs).not.toBe(undefined)
    })

    it('@deprecated.replace on a MySQL table includes replacement text', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'table',
        objectName: 'old_users',
        tag: { name: 'replace', args: ['accounts'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: "ALTER TABLE `old_users` COMMENT = 'DEPRECATED: use accounts instead';" }])
    })

    it('@deprecated on a MySQL view returns docs-only output (no sql)', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'view',
        objectName: 'active_users',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([])
      expect(result.docs).not.toBe(undefined)
    })

    it('@deprecated on a MySQL function returns docs-only output (no sql)', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'function',
        objectName: 'get_user',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([])
      expect(result.docs).not.toBe(undefined)
    })

    it('@deprecated on a MySQL type returns docs-only output (no sql)', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'type',
        objectName: 'status_enum',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([])
      expect(result.docs).not.toBe(undefined)
    })
  })

  describe('onTag -- SQLite', () => {
    it('@deprecated on SQLite table returns docs-only output (no sql)', () => {
      const ctx = makeTagCtx({
        dialect: 'sqlite',
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([])
      expect(result.docs).not.toBe(undefined)
    })

    it('@deprecated.replace on SQLite returns docs-only with replacement info', () => {
      const ctx = makeTagCtx({
        dialect: 'sqlite',
        target: 'table',
        objectName: 'old_users',
        tag: { name: 'replace', args: ['accounts'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([])
      expect(result.docs.columns[0].value).toBe('Deprecated \u2192 accounts')
    })

    it('@deprecated.remove on SQLite returns docs-only with removal date', () => {
      const ctx = makeTagCtx({
        dialect: 'sqlite',
        target: 'column',
        objectName: 'users',
        columnName: 'email',
        tag: { name: 'remove', args: ['2025-06-01'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([])
      expect(result.docs.columns[0].value).toBe('Remove after 2025-06-01')
    })
  })

  describe('validation', () => {
    it('@deprecated tags have no validate function (metadata only)', () => {
      expect(plugin.tags.$self!.validate).toBe(undefined)
      expect(plugin.tags.replace.validate).toBe(undefined)
      expect(plugin.tags.remove.validate).toBe(undefined)
    })
  })
})
