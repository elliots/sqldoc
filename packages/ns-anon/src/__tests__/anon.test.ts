import { describe, it } from 'node:test'
import { makeTagCtx } from '@sqldoc/core/test'
import { expect } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('ns-anon plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "anon"', () => {
    expect(plugin.name).toBe('anon')
  })

  it('has mask, fake, and $self tag entries', () => {
    expect('mask' in plugin.tags).toBeTruthy()
    expect('fake' in plugin.tags).toBeTruthy()
    expect('$self' in plugin.tags).toBeTruthy()
  })

  describe('onTag', () => {
    it('@anon.mask produces SECURITY LABEL statement', () => {
      const ctx = makeTagCtx({
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
      const ctx = makeTagCtx({
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
      const ctx = makeTagCtx({
        target: 'table',
        columnName: undefined,
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
    })

    it('mask with missing columnName returns undefined', () => {
      const ctx = makeTagCtx({
        columnName: undefined,
        tag: { name: 'mask', args: ['anon.fake_last_name()'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
    })

    it('fake with missing columnName returns undefined', () => {
      const ctx = makeTagCtx({
        columnName: undefined,
        tag: { name: 'fake', args: ['anon.fake_email()'] },
      })
      const result = plugin.onTag!(ctx)
      expect(result).toBe(undefined)
    })
  })
})
