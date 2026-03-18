import type { TagContext } from '@sqldoc/core'
import { describe, expect, it } from 'vitest'
import plugin from '../index'

function makeCtx(overrides: Partial<TagContext> = {}): TagContext {
  return {
    target: 'column',
    objectName: 'users',
    columnName: 'username',
    columnType: 'text',
    tag: { name: 'check', args: {} },
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

describe('ns-validate plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "validate"', () => {
    expect(plugin.name).toBe('validate')
  })

  it('has all tag entries', () => {
    expect(plugin.tags).toHaveProperty('check')
    expect(plugin.tags).toHaveProperty('notEmpty')
    expect(plugin.tags).toHaveProperty('range')
    expect(plugin.tags).toHaveProperty('length')
    expect(plugin.tags).toHaveProperty('pattern')
  })

  describe('onTag', () => {
    it('@validate.check generates ALTER TABLE ADD CONSTRAINT with CHECK', () => {
      const ctx = makeCtx({
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
      const ctx = makeCtx({
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
      const ctx = makeCtx({
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
      const ctx = makeCtx({
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
      const ctx = makeCtx({
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
      const ctx = makeCtx({
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
      const ctx = makeCtx({
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
      expect(result).toBeUndefined()
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
      expect(result).toBeUndefined()
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
      expect(result).toBeUndefined()
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
})
