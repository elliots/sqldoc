import { describe, it } from 'node:test'
import type { CompilerOutput } from '@sqldoc/core'
import { expect } from '@sqldoc/test-utils'
import { mergeSchemaWithTags } from '../merge.ts'
import type { AtlasSchema } from '../types.ts'

// -- Fixtures --

function makeAtlasSchema(overrides: Partial<AtlasSchema> = {}): AtlasSchema {
  return {
    schemas: [
      {
        name: 'public',
        tables: [
          {
            name: 'users',
            columns: [
              { name: 'id', type: 'bigserial' },
              { name: 'email', type: 'text', null: true },
              { name: 'name', type: 'text' },
            ],
            primary_key: { parts: [{ column: 'id' }] },
            indexes: [{ name: 'users_email_idx', unique: true, parts: [{ column: 'email' }] }],
            foreign_keys: [],
          },
        ],
        ...overrides.schemas?.[0],
      },
    ],
    ...overrides,
  }
}

function makeFileTags(
  objects: Array<{
    objectName: string
    target: 'table' | 'column' | 'view' | 'function' | 'type' | 'index' | 'trigger'
    tags: Array<{ namespace: string; tag: string | null; args: Record<string, unknown> | unknown[] }>
  }> = [],
) {
  return [
    {
      sourceFile: 'schema.sql',
      objects,
    },
  ]
}

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

// -- Tests --

describe('mergeSchemaWithTags', () => {
  it('merges Atlas table with matching sqldoc tags by normalized name', () => {
    const schema = makeAtlasSchema()
    const fileTags = makeFileTags([
      {
        objectName: 'users',
        target: 'table',
        tags: [{ namespace: 'docs', tag: 'description', args: ['User accounts table'] }],
      },
    ])

    const result = mergeSchemaWithTags(schema, 'erDiagram', fileTags, [], 'Test')

    expect(result.tables).toHaveLength(1)
    expect(result.tables[0].name).toBe('users')
    expect(result.tables[0].description).toBe('User accounts table')
  })

  it('docs.emit(false) excludes table from output', () => {
    const schema = makeAtlasSchema()
    const fileTags = makeFileTags([
      {
        objectName: 'users',
        target: 'table',
        tags: [{ namespace: 'docs', tag: 'emit', args: [false] }],
      },
    ])

    const result = mergeSchemaWithTags(schema, 'erDiagram', fileTags, [], 'Test')

    expect(result.tables).toHaveLength(0)
  })

  it('docs.emit(true) or no emit tag includes table (default include)', () => {
    const schema = makeAtlasSchema()
    // No tags at all -- default include
    const result1 = mergeSchemaWithTags(schema, 'erDiagram', [], [], 'Test')
    expect(result1.tables).toHaveLength(1)

    // Explicit emit(true)
    const fileTags = makeFileTags([
      {
        objectName: 'users',
        target: 'table',
        tags: [{ namespace: 'docs', tag: 'emit', args: [true] }],
      },
    ])
    const result2 = mergeSchemaWithTags(schema, 'erDiagram', fileTags, [], 'Test')
    expect(result2.tables).toHaveLength(1)
  })

  it('docs.description on table sets MergedTable.description', () => {
    const schema = makeAtlasSchema()
    const fileTags = makeFileTags([
      {
        objectName: 'users',
        target: 'table',
        tags: [{ namespace: 'docs', tag: 'description', args: ['Core user accounts'] }],
      },
    ])

    const result = mergeSchemaWithTags(schema, '', fileTags, [], 'Test')

    expect(result.tables[0].description).toBe('Core user accounts')
  })

  it('docs.description on column sets MergedColumn.description', () => {
    const schema = makeAtlasSchema()
    const fileTags = makeFileTags([
      {
        objectName: 'email',
        target: 'column',
        tags: [{ namespace: 'docs', tag: 'description', args: ['Primary email address'] }],
      },
    ])

    const result = mergeSchemaWithTags(schema, '', fileTags, [], 'Test')

    const emailCol = result.tables[0].columns.find((c) => c.name === 'email')
    expect(emailCol?.description).toBe('Primary email address')
  })

  it('tags from ALL namespaces (not just docs) are included on MergedTable.tags', () => {
    const schema = makeAtlasSchema()
    const fileTags = makeFileTags([
      {
        objectName: 'users',
        target: 'table',
        tags: [
          { namespace: 'docs', tag: 'description', args: ['User accounts'] },
          { namespace: 'audit', tag: 'track', args: { operations: ['INSERT', 'UPDATE'] } },
          { namespace: 'rls', tag: 'policy', args: ['admin_only'] },
        ],
      },
    ])

    const result = mergeSchemaWithTags(schema, '', fileTags, [], 'Test')

    expect(result.tables[0].tags).toHaveLength(3)
    expect(result.tables[0].tags.map((t) => t.namespace)).toEqual(['docs', 'audit', 'rls'])
  })

  it('PK columns flagged isPrimaryKey: true', () => {
    const schema = makeAtlasSchema()

    const result = mergeSchemaWithTags(schema, '', [], [], 'Test')

    const idCol = result.tables[0].columns.find((c) => c.name === 'id')
    expect(idCol?.isPrimaryKey).toBe(true)

    const emailCol = result.tables[0].columns.find((c) => c.name === 'email')
    expect(emailCol?.isPrimaryKey).toBe(false)
  })

  it('FK columns flagged isForeignKey: true', () => {
    const schema: AtlasSchema = {
      schemas: [
        {
          name: 'public',
          tables: [
            {
              name: 'posts',
              columns: [
                { name: 'id', type: 'bigserial' },
                { name: 'user_id', type: 'bigint' },
                { name: 'title', type: 'text' },
              ],
              primary_key: { parts: [{ column: 'id' }] },
              foreign_keys: [
                {
                  name: 'posts_user_id_fkey',
                  columns: ['user_id'],
                  references: { table: 'users', columns: ['id'] },
                },
              ],
            },
          ],
        },
      ],
    }

    const result = mergeSchemaWithTags(schema, '', [], [], 'Test')

    const userIdCol = result.tables[0].columns.find((c) => c.name === 'user_id')
    expect(userIdCol?.isForeignKey).toBe(true)

    const titleCol = result.tables[0].columns.find((c) => c.name === 'title')
    expect(titleCol?.isForeignKey).toBe(false)
  })

  it('column nullable reflects Atlas null field', () => {
    const schema = makeAtlasSchema()

    const result = mergeSchemaWithTags(schema, '', [], [], 'Test')

    const emailCol = result.tables[0].columns.find((c) => c.name === 'email')
    expect(emailCol?.nullable).toBe(true) // email has null: true

    const nameCol = result.tables[0].columns.find((c) => c.name === 'name')
    expect(nameCol?.nullable).toBe(false) // name has no null field
  })

  it('generated tables (from sqlOutputs) marked isGenerated: true with generatedBy', () => {
    const schema: AtlasSchema = {
      schemas: [
        {
          name: 'public',
          tables: [
            {
              name: 'users',
              columns: [{ name: 'id', type: 'bigserial' }],
            },
            {
              name: 'users_audit',
              columns: [
                { name: 'id', type: 'bigserial' },
                { name: 'action', type: 'text' },
              ],
            },
          ],
        },
      ],
    }

    const outputs: CompilerOutput[] = [
      makeOutput({
        sqlOutputs: [
          {
            sql: 'CREATE TABLE "users_audit" (id bigserial, action text);',
            sourceTag: '@audit.track',
          },
        ],
      }),
    ]

    const result = mergeSchemaWithTags(schema, '', [], outputs, 'Test')

    const usersTable = result.tables.find((t) => t.name === 'users')!
    expect(usersTable.isGenerated).toBe(false)
    expect(usersTable.generatedBy).toBe(undefined)

    const auditTable = result.tables.find((t) => t.name === 'users_audit')!
    expect(auditTable.isGenerated).toBe(true)
    expect(auditTable.generatedBy).toBe('audit')
  })

  it('views from Atlas are included in merged output', () => {
    const schema: AtlasSchema = {
      schemas: [
        {
          name: 'public',
          tables: [],
          views: [
            {
              name: 'active_users',
              columns: [
                { name: 'id', type: 'bigserial' },
                { name: 'email', type: 'text', null: true },
              ],
            },
          ],
        },
      ],
    }

    const result = mergeSchemaWithTags(schema, '', [], [], 'Test')

    expect(result.views).toHaveLength(1)
    expect(result.views[0].name).toBe('active_users')
    expect(result.views[0].columns).toHaveLength(2)
    expect(result.views[0].columns[0].nullable).toBe(false) // no null field
    expect(result.views[0].columns[1].nullable).toBe(true) // null: true
  })

  it('case-insensitive name matching between Atlas and sqldoc tags', () => {
    const schema = makeAtlasSchema()
    // Use quoted uppercase name in tags
    const fileTags = makeFileTags([
      {
        objectName: '"Users"',
        target: 'table',
        tags: [{ namespace: 'docs', tag: 'description', args: ['Matched despite case'] }],
      },
    ])

    const result = mergeSchemaWithTags(schema, '', fileTags, [], 'Test')

    expect(result.tables[0].description).toBe('Matched despite case')
  })

  it('mermaidERD is passed through to MergedSchema', () => {
    const schema = makeAtlasSchema()
    const mermaid = 'erDiagram\n    users {\n      bigserial id PK\n    }'

    const result = mergeSchemaWithTags(schema, mermaid, [], [], 'Test')

    expect(result.mermaidERD).toBe(mermaid)
  })

  it('generatedAt is a valid ISO date string', () => {
    const schema = makeAtlasSchema()

    const result = mergeSchemaWithTags(schema, '', [], [], 'Test')

    expect(result.generatedAt).not.toBe(undefined)
    const date = new Date(result.generatedAt)
    expect(!Number.isNaN(date.getTime())).toBeTruthy()
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('docs.emit(false) on view excludes it from output', () => {
    const schema: AtlasSchema = {
      schemas: [
        {
          name: 'public',
          tables: [],
          views: [
            {
              name: 'hidden_view',
              columns: [{ name: 'id', type: 'int' }],
            },
          ],
        },
      ],
    }
    const fileTags = makeFileTags([
      {
        objectName: 'hidden_view',
        target: 'view',
        tags: [{ namespace: 'docs', tag: 'emit', args: [false] }],
      },
    ])

    const result = mergeSchemaWithTags(schema, '', fileTags, [], 'Test')

    expect(result.views).toHaveLength(0)
  })

  it('docs.previously on table sets MergedTable.previously', () => {
    const schema = makeAtlasSchema()
    const fileTags = makeFileTags([
      {
        objectName: 'users',
        target: 'table',
        tags: [{ namespace: 'docs', tag: 'previously', args: ['old_users'] }],
      },
    ])

    const result = mergeSchemaWithTags(schema, '', fileTags, [], 'Test')

    expect(result.tables[0].previously).toBe('old_users')
  })

  it('docs.previously on column sets MergedColumn.previously', () => {
    const schema = makeAtlasSchema()
    const fileTags = makeFileTags([
      {
        objectName: 'email',
        target: 'column',
        tags: [{ namespace: 'docs', tag: 'previously', args: ['email_address'] }],
      },
    ])

    const result = mergeSchemaWithTags(schema, '', fileTags, [], 'Test')

    const emailCol = result.tables[0].columns.find((c) => c.name === 'email')
    expect(emailCol?.previously).toBe('email_address')
  })

  it('previously is undefined when no @docs.previously tag', () => {
    const schema = makeAtlasSchema()
    const result = mergeSchemaWithTags(schema, '', [], [], 'Test')

    expect(result.tables[0].previously).toBe(undefined)
    for (const col of result.tables[0].columns) {
      expect(col.previously).toBe(undefined)
    }
  })
})
