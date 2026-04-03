import { describe, expect, it } from '@sqldoc/test-utils'
import typescript from '../typescript/index.ts'

const generate = typescript.generate

import type { AtlasRealm } from '@sqldoc/db'
import type { TemplateContext } from '@sqldoc/ns-codegen'

const testRealm: AtlasRealm = {
  schemas: [
    {
      name: 'public',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: { T: 'bigserial', null: false, category: 'integer' } },
            { name: 'email', type: { T: 'character varying', raw: 'varchar(255)', null: false, category: 'string' } },
            { name: 'name', type: { T: 'text', null: true, category: 'string' } },
            { name: 'age', type: { T: 'integer', null: true, category: 'integer' } },
            { name: 'is_active', type: { T: 'boolean', null: false, category: 'boolean' } },
            { name: 'metadata', type: { T: 'jsonb', null: true, category: 'json' } },
            { name: 'created_at', type: { T: 'timestamp with time zone', null: false, category: 'time' } },
            { name: 'tags', type: { T: 'text[]', null: true, category: 'array' } },
            { name: 'avatar', type: { T: 'bytea', null: true, category: 'binary' } },
            { name: 'balance', type: { T: 'numeric(10,2)', null: true, category: 'decimal' } },
            { name: 'external_id', type: { T: 'uuid', null: true, category: 'uuid' } },
          ],
          primary_key: { parts: [{ column: 'id' }] },
        },
        {
          name: 'posts',
          columns: [
            { name: 'id', type: { T: 'bigserial', null: false, category: 'integer' } },
            { name: 'user_id', type: { T: 'bigint', null: false, category: 'integer' } },
            { name: 'title', type: { T: 'text', null: false, category: 'string' } },
            { name: 'body', type: { T: 'text', null: false, category: 'string' } },
            { name: 'published_at', type: { T: 'timestamp with time zone', null: true, category: 'time' } },
            { name: 'view_count', type: { T: 'integer', null: false, category: 'integer' } },
            { name: 'rating', type: { T: 'double precision', null: true, category: 'float' } },
          ],
          primary_key: { parts: [{ column: 'id' }] },
          foreign_keys: [
            { symbol: 'posts_user_id_fkey', columns: ['user_id'], ref_table: 'users', ref_columns: ['id'] },
          ],
        },
        {
          name: 'comments',
          columns: [
            { name: 'id', type: { T: 'bigserial', null: false, category: 'integer' } },
            { name: 'post_id', type: { T: 'bigint', null: false, category: 'integer' } },
            { name: 'user_id', type: { T: 'bigint', null: false, category: 'integer' } },
            { name: 'content', type: { T: 'text', null: false, category: 'string' } },
            { name: 'created_at', type: { T: 'timestamp with time zone', null: false, category: 'time' } },
          ],
          primary_key: { parts: [{ column: 'id' }] },
          foreign_keys: [
            { symbol: 'comments_post_id_fkey', columns: ['post_id'], ref_table: 'posts', ref_columns: ['id'] },
            { symbol: 'comments_user_id_fkey', columns: ['user_id'], ref_table: 'users', ref_columns: ['id'] },
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
