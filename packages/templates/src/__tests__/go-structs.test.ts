import { describe, expect, it } from 'vitest'
import goStructs from '../go-structs/index.ts'

const generate = goStructs.generate

import type { AtlasRealm } from '@sqldoc/atlas'
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
    config: {},
    output: './out',
    templateName: 'go-structs',
    ...overrides,
  }
}

describe('go-structs template', () => {
  it('generates Go structs with json tags', () => {
    const result = generate(makeCtx())
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('models.go')

    const content = result.files[0].content
    expect(content).toContain('type Users struct {')
    expect(content).toContain('type Posts struct {')
    expect(content).toContain('type Comments struct {')
  })

  it('maps bigserial to int64', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('Id int64')
  })

  it('maps nullable text to *string', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('Name *string')
  })

  it('maps text[] to []string', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('Tags []string')
  })

  it('includes time import for timestamptz', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('import (')
    expect(content).toContain('"time"')
  })

  it('uses omitempty for nullable json tags', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('`json:"name,omitempty"`')
    expect(content).toContain('`json:"email"`')
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
    expect(content).not.toContain('type Comments struct')
    expect(content).toContain('type Users struct')
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
    expect(content).toContain('type Account struct')
    expect(content).not.toContain('type Users struct')
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
              tags: [{ namespace: 'codegen', tag: 'type', args: ['map[string]interface{}'] }],
            },
          ],
        },
      ],
    })
    const result = generate(ctx)
    const content = result.files[0].content
    expect(content).toContain('Metadata map[string]interface{}')
  })
})
