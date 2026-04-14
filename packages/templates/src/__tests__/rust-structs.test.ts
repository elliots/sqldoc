import { describe, expect, it } from '@sqldoc/test-utils'
import rustStructs from '../rust-structs/index.ts'

const generate = rustStructs.generate

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
            { name: 'email', type: { type: { kind: 'string', T: 'varchar(255)' }, null: false } },
            { name: 'name', type: { type: { kind: 'string', T: 'text' }, null: true } },
            { name: 'age', type: { type: { kind: 'integer', T: 'integer' }, null: true } },
            { name: 'is_active', type: { type: { kind: 'boolean', T: 'boolean' }, null: false } },
            { name: 'metadata', type: { type: { kind: 'json', T: 'jsonb' }, null: true } },
            { name: 'created_at', type: { type: { kind: 'time', T: 'timestamptz' }, null: false } },
            { name: 'tags', type: { type: { kind: 'array', T: 'text[]' }, null: true } },
            { name: 'avatar', type: { type: { kind: 'binary', T: 'bytea' }, null: true } },
            { name: 'balance', type: { type: { kind: 'decimal', T: 'numeric(10,2)' }, null: true } },
            { name: 'external_id', type: { type: { kind: 'uuid', T: 'uuid' }, null: true } },
          ],
          primaryKey: { name: 'users_pkey', parts: [{ column: 'id' }] },
        },
        {
          name: 'posts',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, null: false } },
            { name: 'user_id', type: { type: { kind: 'integer', T: 'bigint' }, null: false } },
            { name: 'title', type: { type: { kind: 'string', T: 'text' }, null: false } },
            { name: 'body', type: { type: { kind: 'string', T: 'text' }, null: false } },
            { name: 'published_at', type: { type: { kind: 'time', T: 'timestamptz' }, null: true } },
            { name: 'view_count', type: { type: { kind: 'integer', T: 'integer' }, null: false } },
            { name: 'rating', type: { type: { kind: 'float', T: 'double precision' }, null: true } },
          ],
          primaryKey: { name: 'posts_pkey', parts: [{ column: 'id' }] },
          foreignKeys: [{ symbol: 'posts_user_id_fkey', columns: ['user_id'], refTable: 'users', refColumns: ['id'] }],
        },
      ],
    },
  ],
}

function makeCtx(overrides: Partial<TemplateContext> = {}): TemplateContext<any> {
  return {
    realm: testRealm,
    allFileTags: [],
    docsMeta: [],
    engine: 'postgres',
    dialect: 'postgres',
    config: {},
    output: './generated',
    templateName: 'rust-structs',
    defaultSchema: 'public',
    ...overrides,
  }
}

describe('rust-structs template', () => {
  it('generates valid Rust structs', () => {
    const result = generate(makeCtx())
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('models.rs')
  })

  it('contains pub struct User', () => {
    const result = generate(makeCtx())
    expect(result.files[0].content).toContain('pub struct User {')
  })

  it('maps bigserial to i64', () => {
    const result = generate(makeCtx())
    expect(result.files[0].content).toContain('pub id: i64')
  })

  it('maps nullable text to Option<String>', () => {
    const result = generate(makeCtx())
    expect(result.files[0].content).toContain('pub name: Option<String>')
  })

  it('maps nullable text[] to Option<Vec<String>>', () => {
    const result = generate(makeCtx())
    expect(result.files[0].content).toContain('pub tags: Option<Vec<String>>')
  })

  it('includes chrono use statement for timestamptz', () => {
    const result = generate(makeCtx())
    expect(result.files[0].content).toContain('use chrono::')
  })

  it('includes serde derives', () => {
    const result = generate(makeCtx())
    expect(result.files[0].content).toContain('#[derive(Debug, Clone, Serialize, Deserialize)]')
  })

  it('includes use serde statement', () => {
    const result = generate(makeCtx())
    expect(result.files[0].content).toContain('use serde::{Serialize, Deserialize};')
  })

  it('generates Post struct with correct types', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('pub struct Post {')
    expect(content).toContain('pub user_id: i64')
    expect(content).toContain('pub rating: Option<f64>')
  })

  it('skips tables with @codegen.skip', () => {
    const result = generate(
      makeCtx({
        allFileTags: [
          {
            sourceFile: 'test.sql',
            objects: [
              {
                objectName: 'users',
                target: 'table',
                tags: [{ namespace: 'codegen', tag: 'skip', args: [] }],
              },
            ],
          },
        ],
      }),
    )
    const content = result.files[0].content
    expect(content).not.toContain('pub struct User')
    expect(content).toContain('pub struct Post')
  })

  it('applies @codegen.rename to struct name', () => {
    const result = generate(
      makeCtx({
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
      }),
    )
    expect(result.files[0].content).toContain('pub struct Account {')
    expect(result.files[0].content).not.toContain('pub struct User')
  })

  it('applies @codegen.type override on a column', () => {
    const result = generate(
      makeCtx({
        allFileTags: [
          {
            sourceFile: 'test.sql',
            objects: [
              {
                objectName: 'users.metadata',
                target: 'column',
                tags: [{ namespace: 'codegen', tag: 'type', args: ['MyCustomType'] }],
              },
            ],
          },
        ],
      }),
    )
    expect(result.files[0].content).toContain('pub metadata: Option<MyCustomType>')
  })
})
