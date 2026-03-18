import type { CompilerContext } from '@sqldoc/core'
import { describe, expect, it } from 'vitest'
import plugin from '../index'

function makeCtx(overrides: Partial<CompilerContext> = {}): CompilerContext {
  return {
    target: 'table',
    objectName: 'users',
    tag: { name: '$self', args: ['A table for user accounts'] },
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

describe('ns-comment plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "comment"', () => {
    expect(plugin.name).toBe('comment')
  })

  it('has $self tag definition', () => {
    expect(plugin.tags).toHaveProperty('$self')
  })

  it('$self tag accepts positional string arg', () => {
    const def = plugin.tags.$self!
    expect(def.args).toEqual([{ type: 'string' }])
  })

  describe('generateSQL', () => {
    it('generates COMMENT ON TABLE for table target', () => {
      const ctx = makeCtx({
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: ['A table for user accounts'] },
      })
      const result = plugin.generateSQL!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON TABLE "users" IS 'A table for user accounts';` }])
    })

    it('generates COMMENT ON COLUMN for column target', () => {
      const ctx = makeCtx({
        target: 'column',
        objectName: 'users',
        columnName: 'email',
        tag: { name: '$self', args: ['The user email address'] },
      })
      const result = plugin.generateSQL!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON COLUMN "users"."email" IS 'The user email address';` }])
    })

    it('generates COMMENT ON VIEW for view target', () => {
      const ctx = makeCtx({
        target: 'view',
        objectName: 'active_users',
        tag: { name: '$self', args: ['View of currently active users'] },
      })
      const result = plugin.generateSQL!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON VIEW "active_users" IS 'View of currently active users';` }])
    })

    it('generates COMMENT ON FUNCTION for function target', () => {
      const ctx = makeCtx({
        target: 'function',
        objectName: 'get_user_by_id',
        tag: { name: '$self', args: ['Retrieves a user by their ID'] },
      })
      const result = plugin.generateSQL!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON FUNCTION "get_user_by_id" IS 'Retrieves a user by their ID';` }])
    })

    it('generates COMMENT ON TYPE for type target', () => {
      const ctx = makeCtx({
        target: 'type',
        objectName: 'user_role',
        tag: { name: '$self', args: ['Enum of possible user roles'] },
      })
      const result = plugin.generateSQL!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON TYPE "user_role" IS 'Enum of possible user roles';` }])
    })

    it('generates COMMENT ON INDEX for index target', () => {
      const ctx = makeCtx({
        target: 'index',
        objectName: 'idx_users_email',
        tag: { name: '$self', args: ['Index for fast email lookups'] },
      })
      const result = plugin.generateSQL!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON INDEX "idx_users_email" IS 'Index for fast email lookups';` }])
    })

    it('escapes single quotes in description', () => {
      const ctx = makeCtx({
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: ["The user's primary table"] },
      })
      const result = plugin.generateSQL!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON TABLE "users" IS 'The user''s primary table';` }])
    })

    it('handles null tag name the same as $self', () => {
      const ctx = makeCtx({
        target: 'table',
        objectName: 'orders',
        tag: { name: null, args: ['Order records'] },
      })
      const result = plugin.generateSQL!(ctx)
      expect(result).toEqual([{ sql: `COMMENT ON TABLE "orders" IS 'Order records';` }])
    })

    it('returns undefined when no description is provided', () => {
      const ctx = makeCtx({
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: [] },
      })
      const result = plugin.generateSQL!(ctx)
      expect(result).toBeUndefined()
    })

    it('returns undefined for column target without columnName', () => {
      const ctx = makeCtx({
        target: 'column',
        objectName: 'users',
        tag: { name: '$self', args: ['Some description here'] },
      })
      const result = plugin.generateSQL!(ctx)
      expect(result).toBeUndefined()
    })

    it('returns undefined for unknown tag names', () => {
      const ctx = makeCtx({
        tag: { name: 'unknown', args: ['Some text here'] },
      })
      const result = plugin.generateSQL!(ctx)
      expect(result).toBeUndefined()
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
      expect(result).toBeUndefined()
    })
  })
})
