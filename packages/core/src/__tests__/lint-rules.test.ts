import { describe, it } from 'node:test'
import { expect } from '@sqldoc/test-utils'
// Import the actual plugins to test their built-in lint rules
import auditPlugin from '../../../ns-audit/src/index.ts'
import rlsPlugin from '../../../ns-rls/src/index.ts'
import validatePlugin from '../../../ns-validate/src/index.ts'
import type { CompilerOutput, NamespacePlugin, ResolvedConfig } from '../compiler/types.ts'
import { lint } from '../lint.ts'

/** Helper to create a minimal CompilerOutput */
function makeOutput(overrides: Partial<CompilerOutput> = {}): CompilerOutput {
  return {
    sourceFile: 'schema.sql',
    mergedSql: '',
    sqlOutputs: [],
    codeOutputs: [],
    errors: [],
    docsMeta: [],
    fileTags: [],
    ...overrides,
  }
}

describe('built-in lint rules', () => {
  describe('audit.require-audit', () => {
    it('flags tables without @audit tag', () => {
      const plugins = new Map<string, NamespacePlugin>()
      plugins.set('audit', auditPlugin)

      const output = makeOutput({
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [],
          },
          {
            objectName: 'orders',
            target: 'table',
            tags: [],
          },
        ],
      })

      const results = lint([output], plugins, { dialect: 'postgres' })
      expect(results).toHaveLength(2)
      expect(results[0].ruleName).toBe('audit.require-audit')
      expect(results[0].objectName).toBe('users')
      expect(results[0].message).toContain('users')
      expect(results[1].objectName).toBe('orders')
    })

    it('does not flag tables that have @audit', () => {
      const plugins = new Map<string, NamespacePlugin>()
      plugins.set('audit', auditPlugin)

      const output = makeOutput({
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [{ namespace: 'audit', tag: null, args: {} }],
          },
        ],
      })

      const results = lint([output], plugins, { dialect: 'postgres' })
      expect(results).toHaveLength(0)
    })

    it('does not flag tables that have @audit with $self tag', () => {
      const plugins = new Map<string, NamespacePlugin>()
      plugins.set('audit', auditPlugin)

      const output = makeOutput({
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [{ namespace: 'audit', tag: '$self', args: {} }],
          },
        ],
      })

      const results = lint([output], plugins, { dialect: 'postgres' })
      expect(results).toHaveLength(0)
    })

    it('ignores column-level fileTags', () => {
      const plugins = new Map<string, NamespacePlugin>()
      plugins.set('audit', auditPlugin)

      const output = makeOutput({
        fileTags: [
          {
            objectName: 'users.email',
            target: 'column',
            tags: [],
          },
        ],
      })

      const results = lint([output], plugins, { dialect: 'postgres' })
      expect(results).toHaveLength(0)
    })
  })

  describe('rls.require-policy', () => {
    it('flags tables without @rls tag', () => {
      const plugins = new Map<string, NamespacePlugin>()
      plugins.set('rls', rlsPlugin)

      const output = makeOutput({
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [],
          },
        ],
      })

      const results = lint([output], plugins, { dialect: 'postgres' })
      expect(results).toHaveLength(1)
      expect(results[0].ruleName).toBe('rls.require-policy')
      expect(results[0].message).toContain('users')
    })

    it('does not flag tables with @rls', () => {
      const plugins = new Map<string, NamespacePlugin>()
      plugins.set('rls', rlsPlugin)

      const output = makeOutput({
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [{ namespace: 'rls', tag: null, args: {} }],
          },
        ],
      })

      const results = lint([output], plugins, { dialect: 'postgres' })
      expect(results).toHaveLength(0)
    })
  })

  describe('validate.require-pk', () => {
    it('flags tables without a primary key in SQL', () => {
      const plugins = new Map<string, NamespacePlugin>()
      plugins.set('validate', validatePlugin)

      const output = makeOutput({
        mergedSql: `CREATE TABLE users (
  name TEXT NOT NULL,
  email TEXT
);`,
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [],
          },
        ],
      })

      const results = lint([output], plugins, { dialect: 'postgres' })
      expect(results).toHaveLength(1)
      expect(results[0].ruleName).toBe('validate.require-pk')
      expect(results[0].message).toContain('users')
    })

    it('does not flag tables with a primary key', () => {
      const plugins = new Map<string, NamespacePlugin>()
      plugins.set('validate', validatePlugin)

      const output = makeOutput({
        mergedSql: `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);`,
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [],
          },
        ],
      })

      const results = lint([output], plugins, { dialect: 'postgres' })
      expect(results).toHaveLength(0)
    })
  })

  describe('end-to-end: multiple plugins + config + ignore', () => {
    it('applies all rules, config overrides, and @lint.ignore together', () => {
      const plugins = new Map<string, NamespacePlugin>()
      plugins.set('audit', auditPlugin)
      plugins.set('rls', rlsPlugin)

      const config: ResolvedConfig = {
        dialect: 'postgres',
        lint: {
          rules: {
            'audit.require-audit': 'error', // upgrade from warn
          },
        },
      }

      const output = makeOutput({
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [],
          },
          {
            objectName: 'staging_data',
            target: 'table',
            tags: [
              { namespace: 'lint', tag: 'ignore', args: ['audit.require-audit', 'Staging table'] },
              { namespace: 'lint', tag: 'ignore', args: ['rls.require-policy', 'Internal only'] },
            ],
          },
        ],
      })

      const results = lint([output], plugins, config)

      // users: audit.require-audit (error), rls.require-policy (warn)
      // staging_data: audit.require-audit (skip), rls.require-policy (skip)
      expect(results).toHaveLength(4)

      const usersAudit = results.find((r) => r.objectName === 'users' && r.ruleName === 'audit.require-audit')
      expect(usersAudit!.severity).toBe('error')

      const usersRls = results.find((r) => r.objectName === 'users' && r.ruleName === 'rls.require-policy')
      expect(usersRls!.severity).toBe('warn')

      const stagingAudit = results.find((r) => r.objectName === 'staging_data' && r.ruleName === 'audit.require-audit')
      expect(stagingAudit!.severity).toBe('skip')
      expect(stagingAudit!.ignoreReason).toBe('Staging table')

      const stagingRls = results.find((r) => r.objectName === 'staging_data' && r.ruleName === 'rls.require-policy')
      expect(stagingRls!.severity).toBe('skip')
      expect(stagingRls!.ignoreReason).toBe('Internal only')
    })
  })
})
