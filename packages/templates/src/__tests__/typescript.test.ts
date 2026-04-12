import { describe, expect, it } from '@sqldoc/test-utils'
import typescript from '../typescript/index.ts'

const generate = typescript.generate

import type { Realm } from '@sqldoc/db'
import type { TemplateContext } from '@sqldoc/ns-codegen'

const testRealm: Realm = {
  schemas: [
    {
      name: 'public',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, null: false } },
            {
              name: 'email',
              type: { type: { kind: 'string', T: 'character varying' }, raw: 'varchar(255)', null: false },
            },
            { name: 'name', type: { type: { kind: 'string', T: 'text' }, null: true } },
            { name: 'age', type: { type: { kind: 'integer', T: 'integer' }, null: true } },
            { name: 'is_active', type: { type: { kind: 'boolean', T: 'boolean' }, null: false } },
            { name: 'metadata', type: { type: { kind: 'json', T: 'jsonb' }, null: true } },
            { name: 'created_at', type: { type: { kind: 'time', T: 'timestamp with time zone' }, null: false } },
            { name: 'tags', type: { type: { kind: 'array', T: 'text[]' }, null: true } },
            { name: 'avatar', type: { type: { kind: 'binary', T: 'bytea' }, null: true } },
            { name: 'balance', type: { type: { kind: 'decimal', T: 'numeric(10,2)' }, null: true } },
            { name: 'external_id', type: { type: { kind: 'uuid', T: 'uuid' }, null: true } },
          ],
          primaryKey: { parts: [{ column: 'id' }] },
        },
        {
          name: 'posts',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, null: false } },
            { name: 'user_id', type: { type: { kind: 'integer', T: 'bigint' }, null: false } },
            { name: 'title', type: { type: { kind: 'string', T: 'text' }, null: false } },
            { name: 'body', type: { type: { kind: 'string', T: 'text' }, null: false } },
            { name: 'published_at', type: { type: { kind: 'time', T: 'timestamp with time zone' }, null: true } },
            { name: 'view_count', type: { type: { kind: 'integer', T: 'integer' }, null: false } },
            { name: 'rating', type: { type: { kind: 'float', T: 'double precision' }, null: true } },
          ],
          primaryKey: { parts: [{ column: 'id' }] },
          foreignKeys: [{ symbol: 'posts_user_id_fkey', columns: ['user_id'], refTable: 'users', refColumns: ['id'] }],
        },
        {
          name: 'comments',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, null: false } },
            { name: 'post_id', type: { type: { kind: 'integer', T: 'bigint' }, null: false } },
            { name: 'user_id', type: { type: { kind: 'integer', T: 'bigint' }, null: false } },
            { name: 'content', type: { type: { kind: 'string', T: 'text' }, null: false } },
            { name: 'created_at', type: { type: { kind: 'time', T: 'timestamp with time zone' }, null: false } },
          ],
          primaryKey: { parts: [{ column: 'id' }] },
          foreignKeys: [
            { symbol: 'comments_post_id_fkey', columns: ['post_id'], refTable: 'posts', refColumns: ['id'] },
            { symbol: 'comments_user_id_fkey', columns: ['user_id'], refTable: 'users', refColumns: ['id'] },
          ],
        },
      ],
    },
  ],
}

function makeCtx(overrides?: Partial<TemplateContext>): TemplateContext {
  return {
    realm: testRealm,
    allFileTags: [],
    docsMeta: [],
    config: { dialect: 'postgres' },
    output: './out',
    templateName: 'typescript',
    defaultSchema: 'public',
    ...overrides,
  }
}

describe('typescript template', () => {
  it('generates interfaces for all tables', () => {
    const result = generate(makeCtx())
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('models.ts')

    const content = result.files[0].content
    expect(content).toContain('export interface User {')
    expect(content).toContain('export interface Post {')
    expect(content).toContain('export interface Comment {')
  })

  it('maps bigserial to number', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('id: number')
  })

  it('uses optional (?) for nullable columns by default', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('name?: string')
    expect(content).toContain('age?: number')
  })

  it('uses null-union style when configured', () => {
    const result = generate(makeCtx({ config: { nullableStyle: 'null-union' } }))
    const content = result.files[0].content
    expect(content).toContain('name: string | null')
    expect(content).toContain('age: number | null')
  })

  it('maps text[] to string[] array type', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('tags?: string[]')
  })

  it('maps jsonb to Json', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('metadata?: Json')
  })

  it('maps bytea to Buffer', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('avatar?: Buffer')
  })

  it('maps uuid to string', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('externalId?: string')
  })

  it('includes header comment', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('// Generated by @sqldoc/templates/typescript -- DO NOT EDIT')
  })

  it('respects @codegen.skip tag', () => {
    const ctx = makeCtx({
      allFileTags: [
        {
          sourceFile: 'test.sql',
          objects: [
            {
              objectName: 'comments',
              target: 'table',
              tags: [{ namespace: 'codegen', tag: 'skip', args: [] }],
            },
          ],
        },
      ],
    })
    const result = generate(ctx)
    const content = result.files[0].content
    expect(content).not.toContain('export interface Comment')
    expect(content).toContain('export interface User')
  })

  it('respects @codegen.rename tag', () => {
    const ctx = makeCtx({
      allFileTags: [
        {
          sourceFile: 'test.sql',
          objects: [
            {
              objectName: 'users',
              target: 'table',
              tags: [{ namespace: 'codegen', tag: 'rename', args: ['Account'] }],
            },
          ],
        },
      ],
    })
    const result = generate(ctx)
    const content = result.files[0].content
    expect(content).toContain('export interface Account {')
    expect(content).not.toContain('export interface User {')
  })

  it('respects @codegen.type override on column', () => {
    const ctx = makeCtx({
      allFileTags: [
        {
          sourceFile: 'test.sql',
          objects: [
            {
              objectName: 'users.metadata',
              target: 'column',
              tags: [{ namespace: 'codegen', tag: 'type', args: ['Record<string, any>'] }],
            },
          ],
        },
      ],
    })
    const result = generate(ctx)
    const content = result.files[0].content
    expect(content).toContain('metadata?: Record<string, any>')
  })
})
