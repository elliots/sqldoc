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

  describe('onTag -- MySQL', () => {
    it('generates ALTER TABLE COMMENT for table target', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: ['A table for user accounts'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([{ sql: "ALTER TABLE `users` COMMENT = 'A table for user accounts';" }])
    })

    it('generates ALTER TABLE MODIFY COLUMN COMMENT for column target', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'column',
        objectName: 'users',
        columnName: 'email',
        columnType: 'VARCHAR(255)',
        tag: { name: '$self', args: ['The user email address'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([
        { sql: "ALTER TABLE `users` MODIFY COLUMN `email` VARCHAR(255) COMMENT 'The user email address';" },
      ])
    })

    it('uses TEXT as fallback column type when columnType is not set', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'column',
        objectName: 'users',
        columnName: 'email',
        tag: { name: '$self', args: ['The user email address'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([
        { sql: "ALTER TABLE `users` MODIFY COLUMN `email` TEXT COMMENT 'The user email address';" },
      ])
    })

    it('returns undefined for view target (MySQL does not support)', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'view',
        objectName: 'active_users',
        tag: { name: '$self', args: ['View of active users'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
    })

    it('returns undefined for function target (MySQL does not support)', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'function',
        objectName: 'get_user',
        tag: { name: '$self', args: ['Gets a user'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
    })

    it('returns undefined for type target (MySQL does not support)', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'type',
        objectName: 'status_enum',
        tag: { name: '$self', args: ['Status enum'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
    })

    it('returns undefined for index target (MySQL does not support)', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'index',
        objectName: 'idx_users_email',
        tag: { name: '$self', args: ['Email index'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
    })

    it('escapes single quotes in MySQL description', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql',
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: ["The user's primary table"] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toEqual([{ sql: "ALTER TABLE `users` COMMENT = 'The user''s primary table';" }])
    })
  })

  describe('onTag -- SQLite', () => {
    it('returns undefined for table target (SQLite has no comment support)', () => {
      const ctx = makeTagCtx({
        dialect: 'sqlite',
        target: 'table',
        objectName: 'users',
        tag: { name: '$self', args: ['A table for user accounts'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
    })

    it('returns undefined for column target', () => {
      const ctx = makeTagCtx({
        dialect: 'sqlite',
        target: 'column',
        objectName: 'users',
        columnName: 'email',
        tag: { name: '$self', args: ['The email column'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
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
