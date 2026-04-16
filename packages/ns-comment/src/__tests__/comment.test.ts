import { makeTagCtx } from '@sqldoc/core/test'
import { describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('ns-comment plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "comment"', () => {
    expect(plugin.name).toBe('comment')
  })

  it('has $self tag definition', () => {
    expect('$self' in plugin.tags).toBeTruthy()
  })

  it('$self tag accepts positional string arg', () => {
    const def = plugin.tags.$self!
    expect(def.args).toEqual([{ type: 'string' }])
  })

  describe('onTag -- Postgres', () => {
    it('generates COMMENT ON TABLE for table target', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: ['A table for user accounts'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON TABLE "users" IS 'A table for user accounts';` }])
    })

    it('generates COMMENT ON COLUMN for column target', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'column',
        objectName: 'users',
        columnName: 'email',
        tag: { name: '$self', args: ['The user email address'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON COLUMN "users"."email" IS 'The user email address';` }])
    })

    it('generates COMMENT ON VIEW for view target', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'view',
        objectName: 'active_users',
        tag: { name: '$self', args: ['View of currently active users'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON VIEW "active_users" IS 'View of currently active users';` }])
    })

    it('generates COMMENT ON FUNCTION for function target', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'function',
        objectName: 'get_user_by_id',
        tag: { name: '$self', args: ['Retrieves a user by their ID'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON FUNCTION "get_user_by_id" IS 'Retrieves a user by their ID';` }])
    })

    it('generates COMMENT ON TYPE for type target', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'type',
        objectName: 'user_role',
        tag: { name: '$self', args: ['Enum of possible user roles'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON TYPE "user_role" IS 'Enum of possible user roles';` }])
    })

    it('generates COMMENT ON INDEX for index target', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'index',
        objectName: 'idx_users_email',
        tag: { name: '$self', args: ['Index for fast email lookups'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON INDEX "idx_users_email" IS 'Index for fast email lookups';` }])
    })

    it('escapes single quotes in description', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: ["The user's primary table"] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON TABLE "users" IS 'The user''s primary table';` }])
    })

    it('handles null tag name the same as $self', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'table',
        objectName: 'orders',
        tag: { name: null, args: ['Order records'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON TABLE "orders" IS 'Order records';` }])
    })

    it('returns undefined when no description is provided', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: [] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
    })

    it('returns undefined for column target without columnName', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'column',
        objectName: 'users',
        tag: { name: '$self', args: ['Some description here'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
    })

    it('returns undefined for unknown tag names', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        tag: { name: 'unknown', args: ['Some text here'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
    })
  })

  describe('dialect support', () => {
    it('plugin declares Postgres-only support', () => {
      expect(plugin.databases).toEqual(['postgres'])
    })
  })

  describe('validation', () => {
    it('returns info diagnostic for short comments (< 10 chars)', () => {
      const def = plugin.tags.$self!
      const result = def.validate!({
        target: 'table',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: ['Short'],
        objectName: 'users',
      })
      expect(result).toEqual({
        message: 'Consider a more descriptive comment',
        severity: 'info',
      })
    })

    it('returns undefined for sufficiently long comments', () => {
      const def = plugin.tags.$self!
      const result = def.validate!({
        target: 'table',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: ['This is a sufficiently long comment'],
        objectName: 'users',
      })
      expect(result).toBe(undefined)
    })
  })
})
