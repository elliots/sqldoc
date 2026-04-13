import type { MergedSchema } from '../../types'

/**
 * Shared test fixture: 2 tables (one generated, one not), 1 view,
 * a mermaid ERD string, and various tags.
 */
export function makeTestSchema(): MergedSchema {
  return {
    title: 'Test Schema Docs',
    generatedAt: '2026-03-19T00:00:00.000Z',
    mermaidERD: `erDiagram
    users {
      bigserial id PK
      text email
      text name
    }
    posts {
      bigserial id PK
      bigint user_id FK
      text title
    }
    posts }o--o| users : posts_user_id_fkey`,
    tables: [
      {
        name: 'users',
        description: 'User accounts table',
        previously: 'old_users',
        isGenerated: false,
        columns: [
          { name: 'id', type: 'bigserial', nullable: false, isPrimaryKey: true, isForeignKey: false, tags: [] },
          {
            name: 'email',
            type: 'text',
            nullable: true,
            description: 'Primary email',
            previously: 'email_address',
            isPrimaryKey: false,
            isForeignKey: false,
            tags: [],
          },
          { name: 'name', type: 'text', nullable: false, isPrimaryKey: false, isForeignKey: false, tags: [] },
        ],
        indexes: [{ name: 'users_email_idx', unique: true, parts: [{ column: 'email' }] }],
        primaryKey: { parts: [{ column: 'id' }] },
        foreignKeys: [],
        tags: [
          { namespace: 'docs', tag: 'description', args: ['User accounts table'] },
          { namespace: 'audit', tag: 'track', args: { operations: ['INSERT', 'UPDATE'] } },
          { namespace: 'rls', tag: null, args: ['admin_only'] },
        ],
      },
      {
        name: 'posts',
        isGenerated: true,
        generatedBy: 'audit',
        columns: [
          { name: 'id', type: 'bigserial', nullable: false, isPrimaryKey: true, isForeignKey: false, tags: [] },
          { name: 'user_id', type: 'bigint', nullable: false, isPrimaryKey: false, isForeignKey: true, tags: [] },
          { name: 'title', type: 'text', nullable: true, isPrimaryKey: false, isForeignKey: false, tags: [] },
        ],
        indexes: [],
        primaryKey: { parts: [{ column: 'id' }] },
        foreignKeys: [
          {
            symbol: 'posts_user_id_fkey',
            columns: ['user_id'],
            refTable: 'users',
            refColumns: ['id'],
          },
        ],
        tags: [],
      },
    ],
    views: [
      {
        name: 'active_users',
        description: 'Active users view',
        columns: [
          { name: 'id', type: 'bigserial', nullable: false, isPrimaryKey: false, isForeignKey: false, tags: [] },
          { name: 'email', type: 'text', nullable: true, isPrimaryKey: false, isForeignKey: false, tags: [] },
        ],
        tags: [{ namespace: 'docs', tag: 'description', args: ['Active users view'] }],
      },
    ],
    extraRelationships: [],
    annotations: [
      { object: 'users', text: 'Audited (insert, update)' },
      { object: 'users', text: 'RLS enabled' },
    ],
    extraColumnHeaders: ['Anonymization'],
    extraColumnData: new Map([['users:email:Anonymization', 'Masked: anon.fake_email()']]),
  }
}

/**
 * Minimal schema with no tables, no views -- for edge case testing.
 */
export function makeMinimalSchema(): MergedSchema {
  return {
    title: 'Empty Schema',
    generatedAt: '2026-03-19T00:00:00.000Z',
    mermaidERD: 'erDiagram',
    tables: [],
    views: [],
    extraRelationships: [],
    annotations: [],
    extraColumnHeaders: [],
    extraColumnData: new Map(),
  }
}
