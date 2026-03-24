import { describe, expect, it } from 'vitest'
import pythonDataclasses from '../python-dataclasses/index.ts'

const generate = pythonDataclasses.generate

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
    templateName: 'python-dataclasses',
    ...overrides,
  }
}

describe('python-dataclasses template', () => {
  it('generates dataclass definitions', () => {
    const result = generate(makeCtx())
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('models.py')

    const content = result.files[0].content
    expect(content).toContain('@dataclass')
    expect(content).toContain('class Users:')
    expect(content).toContain('class Posts:')
    expect(content).toContain('class Comments:')
  })

  it('maps bigserial to int', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('id: int')
  })

  it('maps nullable text to Optional[str]', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('name: Optional[str]')
  })

  it('maps nullable text[] to Optional[list[str]]', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('tags: Optional[list[str]]')
  })

  it('includes proper Python imports', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('from dataclasses import dataclass')
    expect(content).toContain('from typing import Optional')
    expect(content).toContain('from datetime import datetime')
  })

  it('nullable fields have = None default', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('name: Optional[str] = None')
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
    expect(content).not.toContain('class Comments:')
    expect(content).toContain('class Users:')
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
    expect(content).toContain('class Account:')
    expect(content).not.toContain('class Users:')
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
              tags: [{ namespace: 'codegen', tag: 'type', args: ['dict[str, Any]'] }],
            },
          ],
        },
      ],
    })
    const result = generate(ctx)
    const content = result.files[0].content
    expect(content).toContain('metadata: dict[str, Any]')
  })
})
