import { describe, it } from 'node:test'
import { makeTagCtx } from '@sqldoc/core/test'
import { expect } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('ns-rls plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "rls"', () => {
    expect(plugin.name).toBe('rls')
  })

  it('has policy and $self tag entries', () => {
    expect('policy' in plugin.tags).toBeTruthy()
    expect('$self' in plugin.tags).toBeTruthy()
  })

  describe('onTag', () => {
    it('@rls.$self produces ALTER TABLE ENABLE ROW LEVEL SECURITY', () => {
      const ctx = makeTagCtx({
        objectName: 'users',
        tag: { name: '$self', args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: 'ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;' }])
    })

    it('@rls with null tag name produces ALTER TABLE ENABLE ROW LEVEL SECURITY', () => {
      const ctx = makeTagCtx({
        objectName: 'users',
        tag: { name: null, args: {} },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toEqual([{ sql: 'ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;' }])
    })

    it('@rls.policy with for/to/using produces CREATE POLICY', () => {
      const ctx = makeTagCtx({
        objectName: 'users',
        tag: {
          name: 'policy',
          args: { for: 'select', to: 'viewer_role', using: 'true' },
        },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toHaveLength(1)
      expect(result.sql[0].sql).toContain('CREATE POLICY')
      expect(result.sql[0].sql).toContain('"users_viewer_role_select"')
      expect(result.sql[0].sql).toContain('ON "users"')
      expect(result.sql[0].sql).toContain('FOR SELECT')
      expect(result.sql[0].sql).toContain('TO viewer_role')
      expect(result.sql[0].sql).toContain('USING (true)')
    })

    it('@rls.policy with using and check produces both clauses', () => {
      const ctx = makeTagCtx({
        objectName: 'users',
        tag: {
          name: 'policy',
          args: {
            for: 'all',
            to: 'authenticated',
            using: 'user_id = current_user_id()',
            check: 'user_id = current_user_id()',
          },
        },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql).toHaveLength(1)
      expect(result.sql[0].sql).toContain('"users_authenticated_all"')
      expect(result.sql[0].sql).toContain('FOR ALL')
      expect(result.sql[0].sql).toContain('TO authenticated')
      expect(result.sql[0].sql).toContain('USING (user_id = current_user_id())')
      expect(result.sql[0].sql).toContain('WITH CHECK (user_id = current_user_id())')
    })

    it('policy name is auto-generated from table + role + command', () => {
      const ctx = makeTagCtx({
        objectName: 'orders',
        tag: {
          name: 'policy',
          args: { for: 'insert', to: 'admin_role', using: 'true' },
        },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql[0].sql).toContain('"orders_admin_role_insert"')
    })

    it('@rls.policy with missing to arg defaults to PUBLIC', () => {
      const ctx = makeTagCtx({
        objectName: 'users',
        tag: {
          name: 'policy',
          args: { for: 'select', using: 'true' },
        },
      })
      const result = plugin.onTag!(ctx) as any
      expect(result.sql[0].sql).toContain('TO PUBLIC')
      expect(result.sql[0].sql).toContain('"users_public_select"')
    })
  })
})
