import { describe, expect, it } from '@sqldoc/test-utils'
import goStructs from '../go-structs/index.ts'

const generate = goStructs.generate

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
    config: { dialect: 'postgres', engine: 'postgres' },
    output: './out',
    templateName: 'go-structs',
    defaultSchema: 'public',
    ...overrides,
  }
}

describe('go-structs template', () => {
  it('generates Go structs with json tags', () => {
    const result = generate(makeCtx())
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('models.go')

    const content = result.files[0].content
    expect(content).toContain('type User struct {')
    expect(content).toContain('type Post struct {')
    expect(content).toContain('type Comment struct {')
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
    expect(content).not.toContain('type Comment struct')
    expect(content).toContain('type User struct')
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
    expect(content).not.toContain('type User struct')
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
