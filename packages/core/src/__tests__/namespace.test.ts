import { describe, expect, it } from '@sqldoc/test-utils'
import {
  createRequireTableTagLintRule,
  defineNamespace,
  requireNamespaceOnSameObject,
  requireNamespaceOnSameTable,
} from '../namespace.ts'

describe('defineNamespace()', () => {
  it('dispatches named handlers and derives dialect families from engines', () => {
    const plugin = defineNamespace({
      name: 'audit',
      engines: ['postgres'],
      tags: {
        $self: { description: 'Enable audit', targets: ['table'] },
        policy: { description: 'Add policy', targets: ['table'] },
      },
      handlers: {
        $self: (ctx) => [{ sql: `-- ${ctx.objectName}` }],
        policy: () => [{ sql: '-- policy' }],
      },
    })

    expect(plugin.apiVersion).toBe(1)
    expect(plugin.databases).toEqual(['postgres'])
    expect(plugin.onTag?.({ objectName: 'users', tag: { name: '$self', args: {} } } as any)).toEqual([
      { sql: '-- users' },
    ])
    expect(plugin.onTag?.({ objectName: 'users', tag: { name: 'policy', args: {} } } as any)).toEqual([
      { sql: '-- policy' },
    ])
  })

  it('normalizes example engine/dialect metadata', () => {
    const plugin = defineNamespace({
      name: 'docs',
      tags: {},
      examples: [{ title: 'Basic docs', engine: 'crdb', input: "-- @docs.description('Orders')" }],
    })

    expect(plugin.examples).toEqual([
      {
        title: 'Basic docs',
        engine: 'crdb',
        dialect: 'postgres',
        input: "-- @docs.description('Orders')",
      },
    ])
  })
})

describe('namespace helper validators', () => {
  it('requires a self tag on the same object', () => {
    const validate = requireNamespaceOnSameObject('rls', '@rls.policy requires @rls on the same table')

    expect(
      validate({
        siblingTags: [{ namespace: 'docs', tag: 'description', rawArgs: null }],
      } as any),
    ).toBe('@rls.policy requires @rls on the same table')

    expect(
      validate({
        siblingTags: [{ namespace: 'rls', tag: null, rawArgs: null }],
      } as any),
    ).toBe(undefined)
  })

  it('requires a self tag on the parent table', () => {
    const validate = requireNamespaceOnSameTable('audit', '@audit.redact requires @audit on the same table')

    expect(
      validate({
        objectName: 'users',
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [{ namespace: 'docs', tag: 'description', rawArgs: null }],
          },
        ],
      } as any),
    ).toBe('@audit.redact requires @audit on the same table')

    expect(
      validate({
        objectName: 'users',
        fileTags: [
          {
            objectName: 'users',
            target: 'table',
            tags: [{ namespace: 'audit', tag: null, rawArgs: null }],
          },
        ],
      } as any),
    ).toBe(undefined)
  })
})

describe('createRequireTableTagLintRule()', () => {
  it('produces a standard missing-tag table lint rule', () => {
    const rule = createRequireTableTagLintRule('softdelete', {
      description: 'Tables should have a @softdelete tag',
    })

    const results = rule.check({
      config: { engine: 'postgres', dialect: 'postgres' },
      outputs: [
        {
          sourceFile: 'schema.sql',
          fileTags: [
            { objectName: 'users', target: 'table', tags: [] },
            { objectName: 'posts', target: 'table', tags: [{ namespace: 'softdelete', tag: null, args: {} }] },
          ],
        },
      ],
    } as any)

    expect(results).toEqual([
      {
        objectName: 'users',
        sourceFile: 'schema.sql',
        message: "Table 'users' has no @softdelete tag",
      },
    ])
  })
})
