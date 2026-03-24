import type { AtlasRealm } from '@sqldoc/db'
import { describe, expect, it } from 'vitest'
import { generateMermaidERD } from '../mermaid'

// Minimal mock AtlasRealm matching the actual lowercase JSON from marshal.go
const realm: AtlasRealm = {
  schemas: [
    {
      name: 'public',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: { raw: 'bigint', T: 'bigint', null: false } },
            { name: 'email', type: { raw: 'text', T: 'text', null: false } },
          ],
          primary_key: { parts: [{ column: 'id' }] },
          foreign_keys: [],
        },
        {
          name: 'posts',
          columns: [
            { name: 'id', type: { raw: 'bigint', T: 'bigint', null: false } },
            { name: 'user_id', type: { raw: 'bigint', T: 'bigint', null: false } },
            { name: 'title', type: { raw: 'text', T: 'text', null: true } },
          ],
          primary_key: { parts: [{ column: 'id' }] },
          foreign_keys: [
            {
              symbol: 'posts_user_id_fkey',
              columns: ['user_id'],
              ref_table: 'users',
              ref_columns: ['id'],
            },
          ],
        },
      ],
      views: [
        {
          name: 'active_users',
          columns: [{ name: 'email', type: { raw: 'text', T: 'text' } }],
        },
      ],
    },
  ],
}

describe('generateMermaidERD', () => {
  it('generates valid erDiagram header', () => {
    const result = generateMermaidERD(realm)
    expect(result).toMatch(/^erDiagram/)
  })

  it('table with columns produces entity block with types', () => {
    const result = generateMermaidERD(realm)
    expect(result).toContain('users {')
    expect(result).toContain('bigint id')
    expect(result).toContain('text email')
  })

  it('PK column marked with PK constraint', () => {
    const result = generateMermaidERD(realm)
    // users.id is PK
    expect(result).toMatch(/bigint id PK/)
  })

  it('FK column marked with FK constraint and produces relationship line', () => {
    const result = generateMermaidERD(realm)
    // posts.user_id is FK
    expect(result).toMatch(/bigint user_id FK/)
    // Relationship line
    expect(result).toMatch(/posts\s+\}o--\|\|\s+users/)
  })

  it('view produces entity block', () => {
    const result = generateMermaidERD(realm)
    expect(result).toContain('active_users {')
    expect(result).toContain('text email')
  })

  it('empty realm produces just "erDiagram"', () => {
    const emptyRealm: AtlasRealm = { schemas: [] }
    const result = generateMermaidERD(emptyRealm)
    expect(result).toBe('erDiagram')
  })

  it('posts.id is both PK (not FK)', () => {
    const result = generateMermaidERD(realm)
    // posts.id should be PK only, not FK
    const lines = result.split('\n')
    const _postIdLine = lines.find((l) => l.includes('posts') || l.trim().startsWith('bigint id'))
    // Within the posts entity, id should have PK
    // Grab lines between "posts {" and the closing "}"
    const postsStart = lines.findIndex((l) => l.includes('posts {'))
    const postsEnd = lines.findIndex((l, i) => i > postsStart && l.trim() === '}')
    const postsLines = lines.slice(postsStart + 1, postsEnd)
    const idLine = postsLines.find((l) => l.trim().startsWith('bigint id'))
    expect(idLine).toBeDefined()
    expect(idLine).toContain('PK')
    expect(idLine).not.toContain('FK')
  })

  it('FK relationship includes foreign key symbol as label', () => {
    const result = generateMermaidERD(realm)
    expect(result).toContain('posts_user_id_fkey')
  })
})
