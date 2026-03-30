import { makeTagCtx } from '@sqldoc/core/test'
import { describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('ns-validate plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "validate"', () => {
    expect(plugin.name).toBe('validate')
  })

  it('has all tag entries', () => {
    expect('check' in plugin.tags).toBeTruthy()
    expect('notEmpty' in plugin.tags).toBeTruthy()
    expect('range' in plugin.tags).toBeTruthy()
    expect('length' in plugin.tags).toBeTruthy()
    expect('pattern' in plugin.tags).toBeTruthy()
  })

  describe('onTag', () => {
    it('@validate.check generates ALTER TABLE ADD CONSTRAINT with CHECK', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'column',
        columnName: 'username',
        columnType: 'text',
        tag: { name: 'check', args: ['length(username) >= 3'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: 'ALTER TABLE "users" ADD CONSTRAINT "users_username_check" CHECK (length(username) >= 3);',
        },
      ])
    })

    it('@validate.notEmpty generates CHECK with length(trim(col)) > 0', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'column',
        columnName: 'email',
        tag: { name: 'notEmpty', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: 'ALTER TABLE "users" ADD CONSTRAINT "users_email_not_empty" CHECK (length(trim("email")) > 0);',
        },
      ])
    })

    it('@validate.range generates CHECK with min/max bounds', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'column',
        columnName: 'age',
        columnType: 'integer',
        tag: { name: 'range', args: { min: 0, max: 150 } },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: 'ALTER TABLE "users" ADD CONSTRAINT "users_age_range" CHECK ("age" >= 0 AND "age" <= 150);',
        },
      ])
    })

    it('@validate.length with both min and max generates combined CHECK', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'column',
        columnName: 'username',
        columnType: 'text',
        tag: { name: 'length', args: { min: 3, max: 50 } },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: 'ALTER TABLE "users" ADD CONSTRAINT "users_username_length" CHECK (length("username") >= 3 AND length("username") <= 50);',
        },
      ])
    })

    it('@validate.length with only min generates >= CHECK', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'column',
        columnName: 'username',
        columnType: 'text',
        tag: { name: 'length', args: { min: 3 } },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: 'ALTER TABLE "users" ADD CONSTRAINT "users_username_length" CHECK (length("username") >= 3);',
        },
      ])
    })

    it('@validate.length with only max generates <= CHECK', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'column',
        columnName: 'username',
        columnType: 'text',
        tag: { name: 'length', args: { max: 255 } },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: 'ALTER TABLE "users" ADD CONSTRAINT "users_username_length" CHECK (length("username") <= 255);',
        },
      ])
    })

    it('@validate.pattern generates CHECK with regex operator', () => {
      const ctx = makeTagCtx({
        dialect: 'postgres',
        target: 'column',
        columnName: 'email',
        tag: { name: 'pattern', args: ['^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: `ALTER TABLE "users" ADD CONSTRAINT "users_email_pattern" CHECK ("email" ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$');`,
        },
      ])
    })
  })

  describe('validation', () => {
    it('@validate.notEmpty warns on non-text column', () => {
      const validate = plugin.tags.notEmpty.validate!
      const result = validate({
        target: 'column',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: {},
        columnName: 'age',
        columnType: 'integer',
        objectName: 'users',
      })
      expect(result).toEqual({
        message: 'notEmpty is typically used on text columns',
        severity: 'warning',
      })
    })

    it('@validate.notEmpty does not warn on text column', () => {
      const validate = plugin.tags.notEmpty.validate!
      const result = validate({
        target: 'column',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: {},
        columnName: 'name',
        columnType: 'text',
        objectName: 'users',
      })
      expect(result).toBe(undefined)
    })

    it('@validate.notEmpty does not warn on varchar column', () => {
      const validate = plugin.tags.notEmpty.validate!
      const result = validate({
        target: 'column',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: {},
        columnName: 'name',
        columnType: 'varchar(255)',
        objectName: 'users',
      })
      expect(result).toBe(undefined)
    })

    it('@validate.range errors when min >= max', () => {
      const validate = plugin.tags.range.validate!
      const result = validate({
        target: 'column',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: { min: 10, max: 5 },
        columnName: 'age',
        columnType: 'integer',
        objectName: 'users',
      })
      expect(result).toBe('min must be less than max')
    })

    it('@validate.range errors when min equals max', () => {
      const validate = plugin.tags.range.validate!
      const result = validate({
        target: 'column',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: { min: 5, max: 5 },
        columnName: 'age',
        columnType: 'integer',
        objectName: 'users',
      })
      expect(result).toBe('min must be less than max')
    })

    it('@validate.range passes with valid min < max', () => {
      const validate = plugin.tags.range.validate!
      const result = validate({
        target: 'column',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: { min: 0, max: 100 },
        columnName: 'age',
        columnType: 'integer',
        objectName: 'users',
      })
      expect(result).toBe(undefined)
    })

    it('@validate.length errors when neither min nor max provided', () => {
      const validate = plugin.tags.length.validate!
      const result = validate({
        target: 'column',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: {},
        columnName: 'name',
        columnType: 'text',
        objectName: 'users',
      })
      expect(result).toBe('at least one of min or max is required')
    })

    it('@validate.length errors when min >= max', () => {
      const validate = plugin.tags.length.validate!
      const result = validate({
        target: 'column',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: { min: 50, max: 10 },
        columnName: 'name',
        columnType: 'text',
        objectName: 'users',
      })
      expect(result).toBe('min must be less than max')
    })

    it('@validate.length warns on non-text column', () => {
      const validate = plugin.tags.length.validate!
      const result = validate({
        target: 'column',
        lines: [],
        siblingTags: [],
        fileTags: [],
        argValues: { min: 1, max: 100 },
        columnName: 'count',
        columnType: 'integer',
        objectName: 'users',
      })
      expect(result).toEqual({
        message: 'length check is typically used on text columns',
        severity: 'warning',
      })
    })
  })

  describe('MySQL dialect', () => {
    it('@validate.check uses backtick quoting', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql' as const,
        target: 'column',
        columnName: 'username',
        columnType: 'text',
        tag: { name: 'check', args: ['length(username) >= 3'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: 'ALTER TABLE `users` ADD CONSTRAINT `users_username_check` CHECK (length(username) >= 3);',
        },
      ])
    })

    it('@validate.notEmpty uses backtick quoting', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql' as const,
        target: 'column',
        columnName: 'email',
        tag: { name: 'notEmpty', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: 'ALTER TABLE `users` ADD CONSTRAINT `users_email_not_empty` CHECK (length(trim(`email`)) > 0);',
        },
      ])
    })

    it('@validate.range uses backtick quoting', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql' as const,
        target: 'column',
        columnName: 'age',
        columnType: 'integer',
        tag: { name: 'range', args: { min: 0, max: 150 } },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: 'ALTER TABLE `users` ADD CONSTRAINT `users_age_range` CHECK (`age` >= 0 AND `age` <= 150);',
        },
      ])
    })

    it('@validate.length uses backtick quoting', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql' as const,
        target: 'column',
        columnName: 'username',
        columnType: 'text',
        tag: { name: 'length', args: { min: 3, max: 50 } },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: 'ALTER TABLE `users` ADD CONSTRAINT `users_username_length` CHECK (length(`username`) >= 3 AND length(`username`) <= 50);',
        },
      ])
    })

    it('@validate.pattern uses REGEXP operator', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql' as const,
        target: 'column',
        columnName: 'email',
        tag: { name: 'pattern', args: ['^[a-z]+$'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: "ALTER TABLE `users` ADD CONSTRAINT `users_email_pattern` CHECK (`email` REGEXP '^[a-z]+$');",
        },
      ])
    })

    it('@validate.notEmpty returns docs metadata', () => {
      const ctx = makeTagCtx({
        dialect: 'mysql' as const,
        target: 'column',
        columnName: 'email',
        tag: { name: 'notEmpty', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.docs).not.toBe(undefined)
      expect(result.docs.columns[0].value).toBe('Not empty')
    })
  })

  describe('SQLite dialect', () => {
    it('@validate.check returns docs-only (no SQL)', () => {
      const ctx = makeTagCtx({
        dialect: 'sqlite' as const,
        target: 'column',
        columnName: 'username',
        columnType: 'text',
        tag: { name: 'check', args: ['length(username) >= 3'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toBe(undefined)
    })

    it('@validate.notEmpty returns docs-only (no SQL)', () => {
      const ctx = makeTagCtx({
        dialect: 'sqlite' as const,
        target: 'column',
        columnName: 'email',
        tag: { name: 'notEmpty', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toBe(undefined)
      expect(result.docs).not.toBe(undefined)
      expect(result.docs.columns[0].value).toBe('Not empty')
    })

    it('@validate.range returns docs-only (no SQL)', () => {
      const ctx = makeTagCtx({
        dialect: 'sqlite' as const,
        target: 'column',
        columnName: 'age',
        columnType: 'integer',
        tag: { name: 'range', args: { min: 0, max: 150 } },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toBe(undefined)
      expect(result.docs).not.toBe(undefined)
    })

    it('@validate.length returns docs-only (no SQL)', () => {
      const ctx = makeTagCtx({
        dialect: 'sqlite' as const,
        target: 'column',
        columnName: 'username',
        columnType: 'text',
        tag: { name: 'length', args: { min: 3, max: 50 } },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toBe(undefined)
      expect(result.docs).not.toBe(undefined)
    })

    it('@validate.pattern returns docs-only (no SQL)', () => {
      const ctx = makeTagCtx({
        dialect: 'sqlite' as const,
        target: 'column',
        columnName: 'email',
        tag: { name: 'pattern', args: ['^[a-z]+$'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toBe(undefined)
      expect(result.docs).not.toBe(undefined)
    })
  })
})
