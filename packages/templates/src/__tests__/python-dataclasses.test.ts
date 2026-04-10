import { describe, expect, it } from '@sqldoc/test-utils'
import pythonDataclasses from '../python-dataclasses/index.ts'

const generate = pythonDataclasses.generate

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

function makeCtx(overrides?: Partial<TemplateContext>): TemplateContext<any> {
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
    expect(content).toContain('class User:')
    expect(content).toContain('class Post:')
    expect(content).toContain('class Comment:')
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
    expect(content).not.toContain('class Comment:')
    expect(content).toContain('class User:')
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
    expect(content).not.toContain('class User:')
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
