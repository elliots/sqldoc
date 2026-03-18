import { describe, expect, it } from 'vitest'
import type { CompilerOutput, LintRule, NamespacePlugin, ResolvedConfig } from '../compiler/types'
import { lint } from '../lint'

/** Helper to create a minimal CompilerOutput */
function makeOutput(overrides: Partial<CompilerOutput> = {}): CompilerOutput {
  return {
    sourceFile: 'test.sql',
    mergedSql: '',
    sqlOutputs: [],
    codeOutputs: [],
    errors: [],
    docsMeta: [],
    fileTags: [],
    ...overrides,
  }
}

/** Helper to create a minimal NamespacePlugin with lint rules */
function makePlugin(name: string, lintRules: LintRule[]): NamespacePlugin {
  return {
    apiVersion: 1,
    name,
    tags: {},
    lintRules,
  }
}

describe('lint engine', () => {
  it('returns empty results when no plugins have lint rules', () => {
    const plugins = new Map<string, NamespacePlugin>()
    plugins.set('test', { apiVersion: 1, name: 'test', tags: {} })

    const results = lint([makeOutput()], plugins, { dialect: 'postgres' })
    expect(results).toEqual([])
  })

  it('runs lint rules from plugins and returns diagnostics', () => {
    const rule: LintRule = {
      name: 'test.always-fail',
      description: 'Always produces a diagnostic',
      default: 'warn',
      check: () => [{ objectName: 'users', sourceFile: 'test.sql', message: 'Test failure' }],
    }

    const plugins = new Map<string, NamespacePlugin>()
    plugins.set('test', makePlugin('test', [rule]))

    const results = lint([makeOutput()], plugins, { dialect: 'postgres' })
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      ruleName: 'test.always-fail',
      severity: 'warn',
      objectName: 'users',
      sourceFile: 'test.sql',
      message: 'Test failure',
    })
  })

  it('applies severity override from config', () => {
    const rule: LintRule = {
      name: 'test.check',
      description: 'Test rule',
      default: 'warn',
      check: () => [{ objectName: 'orders', sourceFile: 'schema.sql', message: 'Missing thing' }],
    }

    const plugins = new Map<string, NamespacePlugin>()
    plugins.set('test', makePlugin('test', [rule]))

    const config: ResolvedConfig = {
      dialect: 'postgres',
      lint: {
        rules: { 'test.check': 'error' },
      },
    }

    const results = lint([makeOutput({ sourceFile: 'schema.sql' })], plugins, config)
    expect(results).toHaveLength(1)
    expect(results[0].severity).toBe('error')
  })

  it('skips rules set to "off" in config', () => {
    const rule: LintRule = {
      name: 'test.check',
      description: 'Test rule',
      default: 'error',
      check: () => [{ objectName: 'users', sourceFile: 'test.sql', message: 'Should not appear' }],
    }

    const plugins = new Map<string, NamespacePlugin>()
    plugins.set('test', makePlugin('test', [rule]))

    const config: ResolvedConfig = {
      dialect: 'postgres',
      lint: {
        rules: { 'test.check': 'off' },
      },
    }

    const results = lint([makeOutput()], plugins, config)
    expect(results).toHaveLength(0)
  })

  it('respects @lint.ignore tags and marks results as "skip"', () => {
    const rule: LintRule = {
      name: 'audit.require-audit',
      description: 'Tables should have @audit',
      default: 'warn',
      check: () => [{ objectName: 'events', sourceFile: 'test.sql', message: "Table 'events' has no @audit tag" }],
    }

    const plugins = new Map<string, NamespacePlugin>()
    plugins.set('audit', makePlugin('audit', [rule]))

    const output = makeOutput({
      sourceFile: 'test.sql',
      fileTags: [
        {
          objectName: 'events',
          target: 'table',
          tags: [{ namespace: 'lint', tag: 'ignore', args: ['audit.require-audit', 'Temporary staging table'] }],
        },
      ],
    })

    const results = lint([output], plugins, { dialect: 'postgres' })
    expect(results).toHaveLength(1)
    expect(results[0].severity).toBe('skip')
    expect(results[0].ignoreReason).toBe('Temporary staging table')
    expect(results[0].message).toBe("Table 'events' has no @audit tag")
  })

  it('does not ignore when @lint.ignore targets a different rule', () => {
    const rule: LintRule = {
      name: 'audit.require-audit',
      description: 'Tables should have @audit',
      default: 'warn',
      check: () => [{ objectName: 'events', sourceFile: 'test.sql', message: "Table 'events' has no @audit tag" }],
    }

    const plugins = new Map<string, NamespacePlugin>()
    plugins.set('audit', makePlugin('audit', [rule]))

    const output = makeOutput({
      sourceFile: 'test.sql',
      fileTags: [
        {
          objectName: 'events',
          target: 'table',
          tags: [{ namespace: 'lint', tag: 'ignore', args: ['rls.require-policy', 'Not needed'] }],
        },
      ],
    })

    const results = lint([output], plugins, { dialect: 'postgres' })
    expect(results).toHaveLength(1)
    expect(results[0].severity).toBe('warn')
  })

  it('collects rules from multiple plugins', () => {
    const rule1: LintRule = {
      name: 'audit.require-audit',
      description: 'Need audit',
      default: 'warn',
      check: () => [{ objectName: 'users', sourceFile: 'test.sql', message: 'No audit' }],
    }

    const rule2: LintRule = {
      name: 'rls.require-policy',
      description: 'Need RLS',
      default: 'error',
      check: () => [{ objectName: 'users', sourceFile: 'test.sql', message: 'No RLS' }],
    }

    const plugins = new Map<string, NamespacePlugin>()
    plugins.set('audit', makePlugin('audit', [rule1]))
    plugins.set('rls', makePlugin('rls', [rule2]))

    const results = lint([makeOutput()], plugins, { dialect: 'postgres' })
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.ruleName)).toEqual(['audit.require-audit', 'rls.require-policy'])
    expect(results[0].severity).toBe('warn')
    expect(results[1].severity).toBe('error')
  })

  it('handles multiple outputs (files) correctly', () => {
    const rule: LintRule = {
      name: 'test.check',
      description: 'Test rule',
      default: 'warn',
      check: (ctx) => {
        const diags = []
        for (const output of ctx.outputs) {
          for (const obj of output.fileTags) {
            if (obj.target === 'table' && !obj.objectName.includes('.')) {
              diags.push({
                objectName: obj.objectName,
                sourceFile: output.sourceFile,
                message: `Missing on ${obj.objectName}`,
              })
            }
          }
        }
        return diags
      },
    }

    const plugins = new Map<string, NamespacePlugin>()
    plugins.set('test', makePlugin('test', [rule]))

    const outputs = [
      makeOutput({
        sourceFile: 'a.sql',
        fileTags: [{ objectName: 'users', target: 'table', tags: [] }],
      }),
      makeOutput({
        sourceFile: 'b.sql',
        fileTags: [{ objectName: 'orders', target: 'table', tags: [] }],
      }),
    ]

    const results = lint(outputs, plugins, { dialect: 'postgres' })
    expect(results).toHaveLength(2)
    expect(results[0].sourceFile).toBe('a.sql')
    expect(results[0].objectName).toBe('users')
    expect(results[1].sourceFile).toBe('b.sql')
    expect(results[1].objectName).toBe('orders')
  })

  it('does not match @lint.ignore across different files', () => {
    const rule: LintRule = {
      name: 'test.check',
      description: 'Test rule',
      default: 'warn',
      check: () => [{ objectName: 'users', sourceFile: 'b.sql', message: 'Problem in b.sql' }],
    }

    const plugins = new Map<string, NamespacePlugin>()
    plugins.set('test', makePlugin('test', [rule]))

    const outputs = [
      makeOutput({
        sourceFile: 'a.sql',
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [{ namespace: 'lint', tag: 'ignore', args: ['test.check', 'Reason'] }],
          },
        ],
      }),
      makeOutput({
        sourceFile: 'b.sql',
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [],
          },
        ],
      }),
    ]

    const results = lint(outputs, plugins, { dialect: 'postgres' })
    expect(results).toHaveLength(1)
    // The ignore is in a.sql but the diagnostic is in b.sql, so it should NOT be skipped
    expect(results[0].severity).toBe('warn')
  })
})
