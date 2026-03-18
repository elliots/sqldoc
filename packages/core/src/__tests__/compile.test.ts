import { describe, expect, it } from 'vitest'
import type { SqlAstAdapter } from '../ast/adapter'
import { compile } from '../compiler/compile'
import type { NamespacePlugin, ProjectConfig, SqlOutput, TagContext } from '../compiler/types'

// ── Task 1: Type extension tests ─────────────────────────────────────

describe('ProjectConfig type extensions', () => {
  it('should accept devUrl field', () => {
    const config: ProjectConfig = {
      dialect: 'postgres',
      devUrl: 'postgres://localhost:5432/test',
      include: ['**/*.sql'],
    }
    expect(config.devUrl).toBe('postgres://localhost:5432/test')
  })

  it('should require dialect', () => {
    const config: ProjectConfig = { dialect: 'postgres' }
    expect(config.devUrl).toBeUndefined()
  })
})

describe('TagContext atlas fields', () => {
  it('should accept atlasTable field', () => {
    const ctx = { atlasTable: { name: 'users', columns: [] } } as Partial<TagContext>
    expect(ctx.atlasTable).toBeDefined()
  })

  it('should accept atlasColumn field', () => {
    const ctx = { atlasColumn: { name: 'email', type: { raw: 'text' } } } as Partial<TagContext>
    expect(ctx.atlasColumn).toBeDefined()
  })

  it('should accept atlasRealm field', () => {
    const ctx = { atlasRealm: { schemas: [{ name: 'public', tables: [] }] } } as Partial<TagContext>
    expect(ctx.atlasRealm).toBeDefined()
  })

  it('should work without atlas fields (Tier 1 backwards compat)', () => {
    const ctx: Partial<TagContext> = {
      target: 'table',
      objectName: 'users',
      tag: { name: null, args: {} },
      namespaceTags: [],
      siblingTags: [],
      fileTags: [],
      astNode: null,
      fileStatements: [],
      config: {},
      filePath: 'test.sql',
    }
    expect(ctx.atlasTable).toBeUndefined()
    expect(ctx.atlasColumn).toBeUndefined()
    expect(ctx.atlasRealm).toBeUndefined()
  })
})

// ── Task 2: compile() with Atlas realm ───────────────────────────────

// Mock Atlas realm for testing (lowercase schema fields, PascalCase Attr variants)
const mockRealm = {
  schemas: [
    {
      name: 'public',
      tables: [
        {
          name: 'users',
          columns: [
            {
              name: 'email',
              type: { raw: 'text', null: false },
              attrs: [{ Name: 'pii.mask', Args: '' }],
            },
            {
              name: 'id',
              type: { raw: 'bigserial', null: false, T: 'bigserial' },
              attrs: [],
            },
          ],
          attrs: [{ Name: 'audit.track', Args: 'on: [delete, update]' }],
        },
      ],
      views: [
        {
          name: 'active_users',
          columns: [{ name: 'email', type: { raw: 'text' } }],
          attrs: [{ Name: 'docs', Args: '' }],
        },
      ],
    },
  ],
}

// Minimal mock adapter -- Tier 2 doesn't need real SQL parsing
const mockAdapter: SqlAstAdapter = {
  init: async () => {},
  parseStatements: () => [],
  parseComments: () => [],
}

function createMockPlugin(onTagFn?: (ctx: TagContext) => SqlOutput[] | undefined): NamespacePlugin {
  return {
    name: 'test-plugin',
    tags: {},
    apiVersion: 1,
    onTag: onTagFn ?? (() => undefined),
  }
}

describe('splitTagName', () => {
  // splitTagName is internal, but we test it via compile behavior
  it('should handle dotted tag name via compile (namespace.tag)', () => {
    const capturedCtx: TagContext[] = []
    const plugin = createMockPlugin((ctx) => {
      capturedCtx.push(ctx)
      return undefined
    })

    const plugins = new Map<string, NamespacePlugin>([['audit', plugin]])

    compile({
      source: '',
      filePath: 'test.sql',
      plugins,
      statements: [],
      adapter: mockAdapter,
      config: { dialect: 'postgres' },
      atlasRealm: mockRealm,
    })

    // Should have invoked audit plugin with tag="track" from "audit.track"
    const auditCall = capturedCtx.find((c) => c.tag.name === 'track')
    expect(auditCall).toBeDefined()
    expect(auditCall!.objectName).toBe('users')
    expect(auditCall!.target).toBe('table')
  })

  it('should handle simple tag name as $self (namespace only)', () => {
    const capturedCtx: TagContext[] = []
    const plugin = createMockPlugin((ctx) => {
      capturedCtx.push(ctx)
      return undefined
    })

    const plugins = new Map<string, NamespacePlugin>([['docs', plugin]])

    compile({
      source: '',
      filePath: 'test.sql',
      plugins,
      statements: [],
      adapter: mockAdapter,
      config: { dialect: 'postgres' },
      atlasRealm: mockRealm,
    })

    // "docs" with no dot -> namespace=docs, tag=null ($self)
    const docsCall = capturedCtx.find((c) => c.tag.name === null)
    expect(docsCall).toBeDefined()
    expect(docsCall!.objectName).toBe('active_users')
    expect(docsCall!.target).toBe('view')
  })
})

describe('compile() Tier 2 (Atlas realm)', () => {
  it('should invoke plugin onTag with atlasTable in context', () => {
    const capturedCtx: TagContext[] = []
    const plugin = createMockPlugin((ctx) => {
      capturedCtx.push(ctx)
      return undefined
    })

    const plugins = new Map<string, NamespacePlugin>([['audit', plugin]])

    const _result = compile({
      source: '',
      filePath: 'test.sql',
      plugins,
      statements: [],
      adapter: mockAdapter,
      config: { dialect: 'postgres' },
      atlasRealm: mockRealm,
    })

    expect(capturedCtx.length).toBeGreaterThan(0)
    const tableCall = capturedCtx.find((c) => c.target === 'table')
    expect(tableCall).toBeDefined()
    expect(tableCall!.atlasTable).toBeDefined()
    expect((tableCall!.atlasTable as any).name).toBe('users')
    expect(tableCall!.atlasRealm).toBe(mockRealm)
  })

  it('should set correct columnName, columnType, atlasColumn for column tags', () => {
    const capturedCtx: TagContext[] = []
    const plugin = createMockPlugin((ctx) => {
      capturedCtx.push(ctx)
      return undefined
    })

    const plugins = new Map<string, NamespacePlugin>([['pii', plugin]])

    compile({
      source: '',
      filePath: 'test.sql',
      plugins,
      statements: [],
      adapter: mockAdapter,
      config: { dialect: 'postgres' },
      atlasRealm: mockRealm,
    })

    expect(capturedCtx.length).toBeGreaterThan(0)
    const colCall = capturedCtx.find((c) => c.target === 'column')
    expect(colCall).toBeDefined()
    expect(colCall!.columnName).toBe('email')
    expect(colCall!.columnType).toBe('text')
    expect(colCall!.objectName).toBe('users')
    expect(colCall!.atlasColumn).toBeDefined()
    expect((colCall!.atlasColumn as any).name).toBe('email')
    expect(colCall!.atlasTable).toBeDefined()
    expect(colCall!.atlasRealm).toBe(mockRealm)
  })

  it('should produce CompilerOutput structure', () => {
    const plugin = createMockPlugin((ctx) => {
      return [{ sql: `-- generated for ${ctx.objectName}` }]
    })

    const plugins = new Map<string, NamespacePlugin>([['audit', plugin]])

    const result = compile({
      source: '',
      filePath: 'test.sql',
      plugins,
      statements: [],
      adapter: mockAdapter,
      config: { dialect: 'postgres' },
      atlasRealm: mockRealm,
    })

    expect(result.sourceFile).toBe('test.sql')
    expect(result.sqlOutputs.length).toBeGreaterThan(0)
    expect(result.errors).toHaveLength(0)
  })

  it('should build fileTags from Atlas data', () => {
    const plugin = createMockPlugin(() => undefined)

    const plugins = new Map<string, NamespacePlugin>([
      ['audit', plugin],
      ['pii', plugin],
      ['docs', plugin],
    ])

    const result = compile({
      source: '',
      filePath: 'test.sql',
      plugins,
      statements: [],
      adapter: mockAdapter,
      config: { dialect: 'postgres' },
      atlasRealm: mockRealm,
    })

    expect(result.fileTags.length).toBeGreaterThan(0)
    const usersEntry = result.fileTags.find((ft) => ft.objectName === 'users')
    expect(usersEntry).toBeDefined()
    expect(usersEntry!.target).toBe('table')
    expect(usersEntry!.tags.length).toBeGreaterThan(0)
  })

  it('should pass namespace config from SqldocConfig', () => {
    const capturedCtx: TagContext[] = []
    const plugin = createMockPlugin((ctx) => {
      capturedCtx.push(ctx)
      return undefined
    })

    const plugins = new Map<string, NamespacePlugin>([['audit', plugin]])

    compile({
      source: '',
      filePath: 'test.sql',
      plugins,
      statements: [],
      adapter: mockAdapter,
      config: { dialect: 'postgres', namespaces: { audit: { destination: 'audit_log' } } },
      atlasRealm: mockRealm,
    })

    const auditCall = capturedCtx.find((c) => c.tag.name === 'track')
    expect(auditCall).toBeDefined()
    expect((auditCall!.config as any).destination).toBe('audit_log')
  })

  it('should handle errors from plugin onTag gracefully', () => {
    const plugin: NamespacePlugin = {
      name: 'broken',
      tags: {},
      apiVersion: 1,
      onTag: () => {
        throw new Error('plugin crashed')
      },
    }

    const plugins = new Map<string, NamespacePlugin>([['audit', plugin]])

    const result = compile({
      source: '',
      filePath: 'test.sql',
      plugins,
      statements: [],
      adapter: mockAdapter,
      config: { dialect: 'postgres' },
      atlasRealm: mockRealm,
    })

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].message).toBe('plugin crashed')
  })

  it('should handle Atlas realm with views', () => {
    const capturedCtx: TagContext[] = []
    const plugin = createMockPlugin((ctx) => {
      capturedCtx.push(ctx)
      return undefined
    })

    const plugins = new Map<string, NamespacePlugin>([['docs', plugin]])

    compile({
      source: '',
      filePath: 'test.sql',
      plugins,
      statements: [],
      adapter: mockAdapter,
      config: { dialect: 'postgres' },
      atlasRealm: mockRealm,
    })

    const viewCall = capturedCtx.find((c) => c.target === 'view')
    expect(viewCall).toBeDefined()
    expect(viewCall!.objectName).toBe('active_users')
    expect(viewCall!.atlasTable).toBeDefined()
  })

  it('should parse atlas tag args', () => {
    const capturedCtx: TagContext[] = []
    const plugin = createMockPlugin((ctx) => {
      capturedCtx.push(ctx)
      return undefined
    })

    const plugins = new Map<string, NamespacePlugin>([['audit', plugin]])

    compile({
      source: '',
      filePath: 'test.sql',
      plugins,
      statements: [],
      adapter: mockAdapter,
      config: { dialect: 'postgres' },
      atlasRealm: mockRealm,
    })

    const auditCall = capturedCtx.find((c) => c.tag.name === 'track')
    expect(auditCall).toBeDefined()
    // Args should be parsed from the Atlas tag args string
    expect(auditCall!.tag.args).toBeDefined()
  })
})

describe('compile() Tier 1 (no Atlas realm)', () => {
  it('should still use block resolution when no atlasRealm provided', () => {
    // Source with tags that block resolution can handle
    const source = `-- @audit.track
CREATE TABLE users (id bigserial PRIMARY KEY);`

    const plugin = createMockPlugin((ctx) => {
      return [{ sql: `-- audited: ${ctx.objectName}` }]
    })

    const plugins = new Map<string, NamespacePlugin>([['audit', plugin]])

    // No atlasRealm -- Tier 1 mode
    const result = compile({
      source,
      filePath: 'test.sql',
      plugins,
      statements: [
        {
          objectName: 'users',
          kind: 'table',
          line: 2,
          raw: null,
          columns: [{ name: 'id', dataType: 'bigserial', line: 2, raw: null }],
        },
      ],
      adapter: mockAdapter,
      config: { dialect: 'postgres' },
    })

    // Should still produce output via block resolution
    expect(result.sqlOutputs.length).toBeGreaterThan(0)
  })
})
