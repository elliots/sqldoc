import type { Realm } from '@sqldoc/core'
import { describe, expect, it } from '@sqldoc/test-utils'
import { generateMermaidERD } from '../mermaid.ts'

const realm: Realm = {
  schemas: [
    {
      name: 'public',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigint' }, raw: 'bigint', null: false } },
            { name: 'email', type: { type: { kind: 'string', T: 'text' }, raw: 'text', null: false } },
          ],
          primaryKey: { parts: [{ column: 'id' }] },
          foreignKeys: [],
        },
        {
          name: 'posts',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigint' }, raw: 'bigint', null: false } },
            { name: 'user_id', type: { type: { kind: 'integer', T: 'bigint' }, raw: 'bigint', null: false } },
            { name: 'title', type: { type: { kind: 'string', T: 'text' }, raw: 'text', null: true } },
          ],
          primaryKey: { parts: [{ column: 'id' }] },
          foreignKeys: [
            {
              symbol: 'posts_user_id_fkey',
              columns: ['user_id'],
              refTable: 'users',
              refColumns: ['id'],
            },
          ],
        },
      ],
      views: [
        {
          name: 'active_users',
          columns: [{ name: 'email', type: { type: { kind: 'string', T: 'text' }, raw: 'text' } }],
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
    expect(result).toMatch(/bigint id PK/)
  })

  it('FK column marked with FK constraint and produces relationship line', () => {
    const result = generateMermaidERD(realm)
    expect(result).toMatch(/bigint user_id FK/)
    expect(result).toMatch(/posts\s+\}o--\|\|\s+users/)
  })

  it('view produces entity block', () => {
    const result = generateMermaidERD(realm)
    expect(result).toContain('active_users {')
    expect(result).toContain('text email')
  })

  it('empty realm produces just "erDiagram"', () => {
    const emptyRealm: Realm = { schemas: [] }
    const result = generateMermaidERD(emptyRealm)
    expect(result).toBe('erDiagram')
  })

  it('posts.id is both PK (not FK)', () => {
    const result = generateMermaidERD(realm)
    const lines = result.split('\n')
    const postsStart = lines.findIndex((l) => l.includes('posts {'))
    const postsEnd = lines.findIndex((l, i) => i > postsStart && l.trim() === '}')
    const postsLines = lines.slice(postsStart + 1, postsEnd)
    const idLine = postsLines.find((l) => l.trim().startsWith('bigint id'))
    expect(idLine).not.toBe(undefined)
    expect(idLine!).toContain('PK')
    expect(idLine!).not.toContain('FK')
  })

  it('FK relationship includes foreign key symbol as label', () => {
    const result = generateMermaidERD(realm)
    expect(result).toContain('posts_user_id_fkey')
  })
})
