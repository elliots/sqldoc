import type { TagContext } from '@sqldoc/core'
import { describe, expect, it } from 'vitest'
import plugin from '../index'

function makeCtx(overrides: Partial<TagContext> = {}): TagContext {
  return {
    target: 'table',
    objectName: 'users',
    tag: { name: 'omit', args: {} },
    namespaceTags: [{ tag: 'omit', args: {} }],
    siblingTags: [],
    fileTags: [],
    astNode: null,
    fileStatements: [],
    config: { dialect: 'postgres' },
    filePath: 'test.sql',
    ...overrides,
  }
}

describe('ns-postgraphile plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "pg"', () => {
    expect(plugin.name).toBe('pg')
  })

  it('has all expected tag entries', () => {
    expect(plugin.tags).toHaveProperty('omit')
    expect(plugin.tags).toHaveProperty(['omit.operations'])
    expect(plugin.tags).toHaveProperty('name')
    expect(plugin.tags).toHaveProperty('deprecated')
    expect(plugin.tags).toHaveProperty('simpleCollections')
    expect(plugin.tags).toHaveProperty('behavior')
  })

  describe('onTag', () => {
    it('@pg.omit on a table', () => {
      const ctx = makeCtx()
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS E'@omit';` }])
    })

    it('@pg.omit on a column', () => {
      const ctx = makeCtx({
        target: 'column',
        objectName: 'users',
        columnName: 'secret',
        tag: { name: 'omit', args: {} },
        namespaceTags: [{ tag: 'omit', args: {} }],
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON COLUMN "users"."secret" IS E'@omit';` }])
    })

    it('@pg.omit on a view', () => {
      const ctx = makeCtx({
        target: 'view',
        objectName: 'active_users',
        tag: { name: 'omit', args: {} },
        namespaceTags: [{ tag: 'omit', args: {} }],
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON VIEW "active_users" IS E'@omit';` }])
    })

    it('@pg.omit on a function', () => {
      const ctx = makeCtx({
        target: 'function',
        objectName: 'my_func',
        tag: { name: 'omit', args: {} },
        namespaceTags: [{ tag: 'omit', args: {} }],
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON FUNCTION "my_func" IS E'@omit';` }])
    })

    it('@pg.omit.operations with specific ops', () => {
      const ctx = makeCtx({
        tag: { name: 'omit.operations', args: { ops: ['create', 'update'] } },
        namespaceTags: [{ tag: 'omit.operations', args: { ops: ['create', 'update'] } }],
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS E'@omit create,update';` }])
    })

    it('@pg.name renames in GraphQL', () => {
      const ctx = makeCtx({
        tag: { name: 'name', args: ['Person'] },
        namespaceTags: [{ tag: 'name', args: ['Person'] }],
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS E'@name Person';` }])
    })

    it('@pg.name on a type', () => {
      const ctx = makeCtx({
        target: 'type',
        objectName: 'user_role',
        tag: { name: 'name', args: ['UserRole'] },
        namespaceTags: [{ tag: 'name', args: ['UserRole'] }],
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TYPE "user_role" IS E'@name UserRole';` }])
    })

    it('@pg.deprecated with reason', () => {
      const ctx = makeCtx({
        tag: { name: 'deprecated', args: ['Use accounts instead'] },
        namespaceTags: [{ tag: 'deprecated', args: ['Use accounts instead'] }],
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS E'@deprecated Use accounts instead';` }])
    })

    it('@pg.deprecated with default reason', () => {
      const ctx = makeCtx({
        tag: { name: 'deprecated', args: [] },
        namespaceTags: [{ tag: 'deprecated', args: [] }],
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS E'@deprecated Deprecated';` }])
    })

    it('@pg.simpleCollections on a table', () => {
      const ctx = makeCtx({
        tag: { name: 'simpleCollections', args: {} },
        namespaceTags: [{ tag: 'simpleCollections', args: {} }],
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS E'@simpleCollections only';` }])
    })

    it('@pg.behavior with custom string', () => {
      const ctx = makeCtx({
        tag: { name: 'behavior', args: ['-query:resource:list'] },
        namespaceTags: [{ tag: 'behavior', args: ['-query:resource:list'] }],
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS E'@behavior -query:resource:list';` }])
    })

    describe('multiple tags combined into one COMMENT ON', () => {
      it('combines @pg.omit.operations and @pg.name into one statement', () => {
        const namespaceTags = [
          { tag: 'omit.operations', args: { ops: ['create', 'delete'] } },
          { tag: 'name', args: ['Person'] },
        ]
        // First tag generates the combined SQL
        const ctx1 = makeCtx({
          tag: { name: 'omit.operations', args: { ops: ['create', 'delete'] } },
          namespaceTags,
        })
        const result1 = plugin.onTag!(ctx1) as any
        expect(result1.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS E'@omit create,delete\\n@name Person';` }])

        // Second tag is skipped (returns undefined)
        const ctx2 = makeCtx({
          tag: { name: 'name', args: ['Person'] },
          namespaceTags,
        })
        const result2 = plugin.onTag!(ctx2)
        expect(result2).toBeUndefined()
      })

      it('combines three tags: omit + deprecated + simpleCollections', () => {
        const namespaceTags = [
          { tag: 'omit', args: {} },
          { tag: 'deprecated', args: ['Will be removed in v2'] },
          { tag: 'simpleCollections', args: {} },
        ]
        const ctx = makeCtx({
          tag: { name: 'omit', args: {} },
          namespaceTags,
        })
        const result = plugin.onTag!(ctx) as any
        expect(result.sql).toEqual([
          {
            sql: `COMMENT ON TABLE "users" IS E'@omit\\n@deprecated Will be removed in v2\\n@simpleCollections only';`,
          },
        ])
      })
    })
  })
})
