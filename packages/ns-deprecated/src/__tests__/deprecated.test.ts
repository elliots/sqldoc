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

describe('ns-deprecated plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "deprecated"', () => {
    expect(plugin.name).toBe('deprecated')
  })

  it('has $self, replace, and remove tag entries', () => {
    expect(plugin.tags).toHaveProperty('$self')
    expect(plugin.tags).toHaveProperty('replace')
    expect(plugin.tags).toHaveProperty('remove')
  })

  describe('onTag', () => {
    it('@deprecated on a table generates COMMENT ON TABLE', () => {
      const ctx = makeCtx({
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS 'DEPRECATED';` }])
    })

    it('@deprecated with null tag name generates COMMENT ON TABLE', () => {
      const ctx = makeCtx({
        target: 'table',
        objectName: 'users',
        tag: { name: null, args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "users" IS 'DEPRECATED';` }])
    })

    it('@deprecated on a column generates COMMENT ON COLUMN with qualified name', () => {
      const ctx = makeCtx({
        target: 'column',
        objectName: 'users',
        columnName: 'email',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON COLUMN "users"."email" IS 'DEPRECATED';` }])
    })

    it('@deprecated on a view generates COMMENT ON VIEW', () => {
      const ctx = makeCtx({
        target: 'view',
        objectName: 'active_users',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON VIEW "active_users" IS 'DEPRECATED';` }])
    })

    it('@deprecated on a function generates COMMENT ON FUNCTION', () => {
      const ctx = makeCtx({
        target: 'function',
        objectName: 'get_user',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON FUNCTION "get_user" IS 'DEPRECATED';` }])
    })

    it('@deprecated on a type generates COMMENT ON TYPE', () => {
      const ctx = makeCtx({
        target: 'type',
        objectName: 'status_enum',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TYPE "status_enum" IS 'DEPRECATED';` }])
    })

    it('@deprecated.replace generates COMMENT with replacement suggestion', () => {
      const ctx = makeCtx({
        target: 'table',
        objectName: 'old_users',
        tag: { name: 'replace', args: ['accounts'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON TABLE "old_users" IS 'DEPRECATED: use accounts instead';` }])
    })

    it('@deprecated.remove generates COMMENT with removal date', () => {
      const ctx = makeCtx({
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
      const ctx = makeCtx({
        target: 'column',
        objectName: 'users',
        columnName: 'name',
        tag: { name: 'replace', args: ['full_name'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: `COMMENT ON COLUMN "users"."name" IS 'DEPRECATED: use full_name instead';` }])
    })
  })

  describe('validation', () => {
    it('@deprecated tags have no validate function (metadata only)', () => {
      expect(plugin.tags.$self!.validate).toBeUndefined()
      expect(plugin.tags.replace.validate).toBeUndefined()
      expect(plugin.tags.remove.validate).toBeUndefined()
    })
  })
})
