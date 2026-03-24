import { describe, expect, it } from 'vitest'
import rustStructs from '../rust-structs/index'

const generate = rustStructs.generate

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
            { name: 'email', type: { T: 'varchar(255)', null: false, category: 'string' } },
            { name: 'name', type: { T: 'text', null: true, category: 'string' } },
            { name: 'age', type: { T: 'integer', null: true, category: 'integer' } },
            { name: 'is_active', type: { T: 'boolean', null: false, category: 'boolean' } },
            { name: 'metadata', type: { T: 'jsonb', null: true, category: 'json' } },
            { name: 'created_at', type: { T: 'timestamptz', null: false, category: 'time' } },
            { name: 'tags', type: { T: 'text[]', null: true, category: 'array' } },
            { name: 'avatar', type: { T: 'bytea', null: true, category: 'binary' } },
            { name: 'balance', type: { T: 'numeric(10,2)', null: true, category: 'decimal' } },
            { name: 'external_id', type: { T: 'uuid', null: true, category: 'uuid' } },
          ],
          primary_key: { name: 'users_pkey', parts: [{ column: 'id' }] },
        },
        {
          name: 'posts',
          columns: [
            { name: 'id', type: { T: 'bigserial', null: false, category: 'integer' } },
            { name: 'user_id', type: { T: 'bigint', null: false, category: 'integer' } },
            { name: 'title', type: { T: 'text', null: false, category: 'string' } },
            { name: 'body', type: { T: 'text', null: false, category: 'string' } },
            { name: 'published_at', type: { T: 'timestamptz', null: true, category: 'time' } },
            { name: 'view_count', type: { T: 'integer', null: false, category: 'integer' } },
            { name: 'rating', type: { T: 'double precision', null: true, category: 'float' } },
          ],
          primary_key: { name: 'posts_pkey', parts: [{ column: 'id' }] },
          foreign_keys: [
            { symbol: 'posts_user_id_fkey', columns: ['user_id'], ref_table: 'users', ref_columns: ['id'] },
          ],
        },
      ],
    },
  ],
}

function makeCtx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    realm: testRealm,
    allFileTags: [],
    docsMeta: [],
    config: {},
    output: './generated',
    templateName: 'rust-structs',
    ...overrides,
  }
}

describe('rust-structs template', () => {
  it('generates valid Rust structs', () => {
    const result = generate(makeCtx())
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('models.rs')
  })

  it('contains pub struct Users', () => {
    const result = generate(makeCtx())
    expect(result.files[0].content).toContain('pub struct Users {')
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

  it('generates Posts struct with correct types', () => {
    const result = generate(makeCtx())
    const content = result.files[0].content
    expect(content).toContain('pub struct Posts {')
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
    expect(content).not.toContain('pub struct Users')
    expect(content).toContain('pub struct Posts')
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
    expect(result.files[0].content).not.toContain('pub struct Users')
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
