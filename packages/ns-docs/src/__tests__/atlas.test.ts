import type { Realm } from '@sqldoc/db'
import { describe, expect, it } from '@sqldoc/test-utils'
import { realmToDocsSchema } from '../atlas.ts'

const sampleRealm: Realm = {
  schemas: [
    {
      name: 'public',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, raw: 'bigserial', null: false } },
            { name: 'email', type: { type: { kind: 'string', T: 'text' }, raw: 'text', null: false } },
            { name: 'bio', type: { type: { kind: 'string', T: 'text' }, raw: 'text', null: true } },
          ],
          indexes: [
            {
              name: 'users_email_idx',
              unique: true,
              parts: [{ column: 'email' }],
            },
          ],
          primaryKey: { parts: [{ column: 'id' }] },
          foreignKeys: [],
        },
        {
          name: 'posts',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, raw: 'bigserial', null: false } },
            { name: 'user_id', type: { type: { kind: 'integer', T: 'bigint' }, raw: 'bigint', null: false } },
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

describe('realmToDocsSchema', () => {
  it('converts realm to ns-docs AtlasSchema format', () => {
    const result = realmToDocsSchema(sampleRealm)
    expect(result.schemas).toHaveLength(1)
    expect(result.schemas[0].name).toBe('public')
  })

  it('maps tables with columns', () => {
    const result = realmToDocsSchema(sampleRealm)
    const tables = result.schemas[0].tables!
    expect(tables).toHaveLength(2)
    expect(tables[0].name).toBe('users')
    expect(tables[0].columns).toHaveLength(3)
    expect(tables[0].columns[0].name).toBe('id')
    expect(tables[0].columns[0].type).toBe('bigserial')
  })

  it('maps nullable columns', () => {
    const result = realmToDocsSchema(sampleRealm)
    const bio = result.schemas[0].tables![0].columns[2]
    expect(bio.name).toBe('bio')
    expect(bio.null).toBe(true)
  })

  it('maps primary key', () => {
    const result = realmToDocsSchema(sampleRealm)
    const pk = result.schemas[0].tables![0].primary_key
    expect(pk).not.toBe(undefined)
    expect(pk!.parts[0].column).toBe('id')
  })

  it('maps indexes', () => {
    const result = realmToDocsSchema(sampleRealm)
    const indexes = result.schemas[0].tables![0].indexes!
    expect(indexes).toHaveLength(1)
    expect(indexes[0].name).toBe('users_email_idx')
    expect(indexes[0].unique).toBe(true)
    expect(indexes[0].parts[0].column).toBe('email')
  })

  it('maps foreign keys with references', () => {
    const result = realmToDocsSchema(sampleRealm)
    const fks = result.schemas[0].tables![1].foreign_keys!
    expect(fks).toHaveLength(1)
    expect(fks[0].name).toBe('posts_user_id_fkey')
    expect(fks[0].columns).toEqual(['user_id'])
    expect(fks[0].references.table).toBe('users')
    expect(fks[0].references.columns).toEqual(['id'])
  })

  it('maps views', () => {
    const result = realmToDocsSchema(sampleRealm)
    const views = result.schemas[0].views!
    expect(views).toHaveLength(1)
    expect(views[0].name).toBe('active_users')
    expect(views[0].columns[0].name).toBe('email')
  })

  it('handles empty realm', () => {
    const result = realmToDocsSchema({ schemas: [] })
    expect(result.schemas).toHaveLength(0)
  })

  it('falls back to T when raw is undefined', () => {
    const realm: Realm = {
      schemas: [
        {
          name: 'test',
          tables: [
            {
              name: 't',
              columns: [{ name: 'x', type: { type: { kind: 'integer', T: 'integer' } } }],
            },
          ],
        },
      ],
    }
    const result = realmToDocsSchema(realm)
    expect(result.schemas[0].tables![0].columns[0].type).toBe('integer')
  })
})
