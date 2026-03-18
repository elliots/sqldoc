import type { TagContext } from '@sqldoc/core'
import { describe, expect, it } from 'vitest'
import plugin from '../index'

function makeCtx(overrides: Partial<TagContext> = {}): TagContext {
  return {
    target: 'column',
    objectName: 'users',
    columnName: 'email',
    tag: { name: 'mask', args: ['anon.fake_email()'] },
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

describe('ns-anon plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "anon"', () => {
    expect(plugin.name).toBe('anon')
  })

  it('has mask, fake, and $self tag entries', () => {
    expect(plugin.tags).toHaveProperty('mask')
    expect(plugin.tags).toHaveProperty('fake')
    expect(plugin.tags).toHaveProperty('$self')
  })

  describe('onTag', () => {
    it('@anon.mask produces SECURITY LABEL statement', () => {
      const ctx = makeCtx({
        objectName: 'users',
        columnName: 'last_name',
        tag: { name: 'mask', args: ['anon.fake_last_name()'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: `SECURITY LABEL FOR anon ON COLUMN "users"."last_name" IS 'MASKED WITH FUNCTION anon.fake_last_name()';`,
        },
      ])
    })

    it('@anon.fake produces SECURITY LABEL statement', () => {
      const ctx = makeCtx({
        objectName: 'users',
        columnName: 'email',
        tag: { name: 'fake', args: ['anon.fake_email()'] },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([
        {
          sql: `SECURITY LABEL FOR anon ON COLUMN "users"."email" IS 'MASKED WITH FUNCTION anon.fake_email()';`,
        },
      ])
    })

    it('@anon.$self with no args on table returns undefined', () => {
      const ctx = makeCtx({
        target: 'table',
        columnName: undefined,
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBeUndefined()
    })

    it('mask with missing columnName returns undefined', () => {
      const ctx = makeCtx({
        columnName: undefined,
        tag: { name: 'mask', args: ['anon.fake_last_name()'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBeUndefined()
    })

    it('fake with missing columnName returns undefined', () => {
      const ctx = makeCtx({
        columnName: undefined,
        tag: { name: 'fake', args: ['anon.fake_email()'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBeUndefined()
    })
  })
})
