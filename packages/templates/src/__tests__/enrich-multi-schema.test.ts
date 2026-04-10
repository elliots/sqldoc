/**
 * Multi-schema enrichment tests — validates schema-aware naming, clash
 * detection, FK schema resolution, and stripSchemaFromName behavior.
 */

import type { Realm } from '@sqldoc/db'
import type { TemplateContext } from '@sqldoc/ns-codegen'
import { describe, expect, it } from '@sqldoc/test-utils'
import { enrichRealm } from '../helpers/enrich.ts'

// ── Fixtures ────────────────────────────────────────────────────────

const singleSchemaRealm: Realm = {
  schemas: [
    {
      name: 'public',
      tables: [
        {
          name: 'users',
          columns: [{ name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, null: false } }],
          primaryKey: { parts: [{ column: 'id' }] },
        },
        {
          name: 'posts',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, null: false } },
            { name: 'user_id', type: { type: { kind: 'integer', T: 'bigint' }, null: false } },
          ],
          primaryKey: { parts: [{ column: 'id' }] },
          foreignKeys: [{ symbol: 'posts_user_id_fkey', columns: ['user_id'], refTable: 'users', refColumns: ['id'] }],
        },
      ],
    },
  ],
}

const multiSchemaRealm: Realm = {
  schemas: [
    {
      name: 'auth',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, null: false } },
            { name: 'role_id', type: { type: { kind: 'integer', T: 'bigint' }, null: false } },
          ],
          primaryKey: { parts: [{ column: 'id' }] },
          foreignKeys: [{ symbol: 'users_role_id_fkey', columns: ['role_id'], refTable: 'roles', refColumns: ['id'] }],
        },
      ],
    },
    {
      name: 'core',
      tables: [
        {
          name: 'projects',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, null: false } },
            { name: 'owner_id', type: { type: { kind: 'integer', T: 'bigint' }, null: false } },
          ],
          primaryKey: { parts: [{ column: 'id' }] },
          foreignKeys: [
            { symbol: 'projects_owner_id_fkey', columns: ['owner_id'], refTable: 'users', refColumns: ['id'] },
          ],
        },
        {
          name: 'roles',
          columns: [
            { name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, null: false } },
            { name: 'name', type: { type: { kind: 'string', T: 'text' }, null: false } },
          ],
          primaryKey: { parts: [{ column: 'id' }] },
        },
      ],
    },
  ],
}

const clashRealm: Realm = {
  schemas: [
    {
      name: 'auth',
      tables: [
        {
          name: 'users',
          columns: [{ name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, null: false } }],
          primaryKey: { parts: [{ column: 'id' }] },
        },
      ],
    },
    {
      name: 'core',
      tables: [
        {
          name: 'users',
          columns: [{ name: 'id', type: { type: { kind: 'integer', T: 'bigserial' }, null: false } }],
          primaryKey: { parts: [{ column: 'id' }] },
        },
      ],
    },
  ],
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeCtx(realm: Realm, overrides?: Partial<TemplateContext>): TemplateContext {
  return {
    realm,
    allFileTags: [],
    docsMeta: [],
    config: {},
    output: './out',
    templateName: 'typescript',
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('multi-schema enrichment', () => {
  it('Test 1: single-schema realm produces identical pascalName (no prefix)', () => {
    const result = enrichRealm(makeCtx(singleSchemaRealm))
    const users = result.tables.find((t) => t.name === 'users')!
    const posts = result.tables.find((t) => t.name === 'posts')!

    expect(users.pascalName).toBe('User')
    expect(posts.pascalName).toBe('Post')
    expect(users.schema).toBe('public')
    expect(posts.schema).toBe('public')
    expect(users.sqlName).toBe('users')
    expect(posts.sqlName).toBe('posts')
  })

  it('Test 2: multi-schema realm adds schema prefix to pascalName', () => {
    const result = enrichRealm(makeCtx(multiSchemaRealm))
    const users = result.tables.find((t) => t.name === 'users')!
    const projects = result.tables.find((t) => t.name === 'projects')!

    expect(users.pascalName).toBe('AuthUser')
    expect(projects.pascalName).toBe('CoreProject')
    expect(users.schema).toBe('auth')
    expect(projects.schema).toBe('core')
    expect(users.sqlName).toBe('auth.users')
    expect(projects.sqlName).toBe('core.projects')
  })

  it('Test 3: stripSchemaFromName removes prefix', () => {
    const result = enrichRealm(makeCtx(multiSchemaRealm, { stripSchemaFromName: true }))
    const users = result.tables.find((t) => t.name === 'users')!
    const projects = result.tables.find((t) => t.name === 'projects')!

    expect(users.pascalName).toBe('User')
    expect(projects.pascalName).toBe('Project')
  })

  it('Test 4: name clash with stripSchemaFromName throws error', () => {
    expect(() => enrichRealm(makeCtx(clashRealm, { stripSchemaFromName: true }))).toThrow(/name clash/i)
    // Error should list both conflicting tables
    try {
      enrichRealm(makeCtx(clashRealm, { stripSchemaFromName: true }))
    } catch (err: any) {
      expect(err.message).toContain('auth.users')
      expect(err.message).toContain('core.users')
    }
  })

  it('Test 5: name clash without stripSchemaFromName does NOT throw (different prefixes)', () => {
    const result = enrichRealm(makeCtx(clashRealm))
    const authUsers = result.tables.find((t) => t.schema === 'auth')!
    const coreUsers = result.tables.find((t) => t.schema === 'core')!

    expect(authUsers.pascalName).toBe('AuthUser')
    expect(coreUsers.pascalName).toBe('CoreUser')
  })

  it('Test 6: @codegen.rename overrides schema prefix', () => {
    const ctx = makeCtx(multiSchemaRealm, {
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
    const result = enrichRealm(ctx)
    const users = result.tables.find((t) => t.name === 'users')!

    // Rename should be used as-is, NOT "AuthAccount"
    expect(users.pascalName).toBe('Account')
  })

  it('Test 7: @codegen.rename clash throws error', () => {
    const ctx = makeCtx(multiSchemaRealm, {
      allFileTags: [
        {
          sourceFile: 'test.sql',
          objects: [
            {
              objectName: 'users',
              target: 'table',
              tags: [{ namespace: 'codegen', tag: 'rename', args: ['Account'] }],
            },
            {
              objectName: 'projects',
              target: 'table',
              tags: [{ namespace: 'codegen', tag: 'rename', args: ['Account'] }],
            },
          ],
        },
      ],
    })
    expect(() => enrichRealm(ctx)).toThrow(/name clash/i)
    try {
      enrichRealm(ctx)
    } catch (err: any) {
      expect(err.message).toContain('Account')
    }
  })

  it('Test 8: relation has foreignSchema field', () => {
    const result = enrichRealm(makeCtx(multiSchemaRealm))
    const projects = result.tables.find((t) => t.name === 'projects')!

    // projects.owner_id FK -> auth.users
    expect(projects.belongsTo.length).toBeGreaterThan(0)
    const fk = projects.belongsTo.find((r) => r.foreignTable === 'users')!
    expect(fk.foreignSchema).toBe('auth')
  })

  it('Test 9: EnrichedColumn.foreignKey has schema field', () => {
    const result = enrichRealm(makeCtx(multiSchemaRealm))
    const projects = result.tables.find((t) => t.name === 'projects')!
    const ownerCol = projects.columns.find((c) => c.name === 'owner_id')!

    expect(ownerCol.foreignKey).toBeDefined()
    expect(ownerCol.foreignKey!.schema).toBe('auth')
  })

  it('Test 10: hasMany reverse FK index uses schema-qualified key', () => {
    const result = enrichRealm(makeCtx(multiSchemaRealm))
    const roles = result.tables.find((t) => t.name === 'roles')!

    // auth.users has FK to core.roles, so roles should have hasMany entry
    expect(roles.hasMany.length).toBeGreaterThan(0)
    const fromUsers = roles.hasMany.find((r) => r.foreignTable === 'users')
    expect(fromUsers).toBeDefined()
  })

  it('Test 11: skipped tables excluded from clash detection', () => {
    const ctx = makeCtx(clashRealm, {
      stripSchemaFromName: true,
      allFileTags: [
        {
          sourceFile: 'test.sql',
          objects: [
            {
              objectName: 'users',
              target: 'table',
              // Skip the core.users (will be matched by first occurrence — but since both have same name,
              // we mark with codegen.skip which applies to all "users" objects)
              tags: [{ namespace: 'codegen', tag: 'skip', args: [] }],
            },
          ],
        },
      ],
    })
    // With one of the clashing tables skipped, no clash error should be thrown
    expect(() => enrichRealm(ctx)).not.toThrow()
  })
})
