/**
 * End-to-end template output tests for multi-schema realms.
 * Verifies that representative templates produce correct output
 * when given a realm with multiple schemas and cross-schema FKs.
 */
import type { AtlasRealm } from '@sqldoc/db'
import type { TemplateContext } from '@sqldoc/ns-codegen'
import { describe, expect, it } from '@sqldoc/test-utils'
import drizzle from '../drizzle/index.ts'
import knex from '../knex/index.ts'
import typescript from '../typescript/index.ts'
import zod from '../zod/index.ts'

// ── Multi-schema realm fixture ───────────────────────────────────

const multiSchemaRealm: AtlasRealm = {
  schemas: [
    {
      name: 'auth',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: { T: 'bigserial', null: false, category: 'integer' } },
            { name: 'email', type: { T: 'text', null: false, category: 'string' } },
            { name: 'role_id', type: { T: 'bigint', null: false, category: 'integer' } },
          ],
          primary_key: { parts: [{ column: 'id' }] },
          foreign_keys: [
            { symbol: 'users_role_id_fkey', columns: ['role_id'], ref_table: 'roles', ref_columns: ['id'] },
          ],
        },
      ],
    },
    {
      name: 'core',
      tables: [
        {
          name: 'roles',
          columns: [
            { name: 'id', type: { T: 'bigserial', null: false, category: 'integer' } },
            { name: 'name', type: { T: 'text', null: false, category: 'string' } },
          ],
          primary_key: { parts: [{ column: 'id' }] },
        },
        {
          name: 'projects',
          columns: [
            { name: 'id', type: { T: 'bigserial', null: false, category: 'integer' } },
            { name: 'name', type: { T: 'text', null: false, category: 'string' } },
            { name: 'owner_id', type: { T: 'bigint', null: false, category: 'integer' } },
          ],
          primary_key: { parts: [{ column: 'id' }] },
          foreign_keys: [
            { symbol: 'projects_owner_id_fkey', columns: ['owner_id'], ref_table: 'users', ref_columns: ['id'] },
          ],
        },
      ],
    },
  ],
}

const singleSchemaRealm: AtlasRealm = {
  schemas: [
    {
      name: 'public',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: { T: 'bigserial', null: false, category: 'integer' } },
            { name: 'email', type: { T: 'text', null: false, category: 'string' } },
          ],
          primary_key: { parts: [{ column: 'id' }] },
        },
        {
          name: 'roles',
          columns: [
            { name: 'id', type: { T: 'bigserial', null: false, category: 'integer' } },
            { name: 'name', type: { T: 'text', null: false, category: 'string' } },
          ],
          primary_key: { parts: [{ column: 'id' }] },
        },
      ],
    },
  ],
}

// ── Helpers ──────────────────────────────────────────────────────

function makeCtx(templateName: string, overrides?: Partial<TemplateContext>): TemplateContext {
  return {
    realm: multiSchemaRealm,
    allFileTags: [],
    docsMeta: [],
    config: { dialect: 'postgres' },
    output: './out',
    templateName,
    defaultSchema: 'public',
    ...overrides,
  }
}

// ── TypeScript template (zero-change template) ──────────────────

describe('multi-schema: typescript template', () => {
  it('uses schema-prefixed interface names', () => {
    const result = typescript.generate(makeCtx('typescript'))
    const content = result.files[0].content

    expect(content).toContain('export interface AuthUser {')
    expect(content).toContain('export interface CoreProject {')
    expect(content).toContain('export interface CoreRole {')
    // Must NOT contain unqualified names
    expect(content).not.toContain('export interface User {')
    expect(content).not.toContain('export interface Project {')
  })

  it('uses unqualified names for single-schema realm', () => {
    const result = typescript.generate(makeCtx('typescript', { realm: singleSchemaRealm }))
    const content = result.files[0].content

    expect(content).toContain('export interface User {')
    expect(content).toContain('export interface Role {')
    // Must NOT contain schema-prefixed names
    expect(content).not.toContain('export interface PublicUser {')
    expect(content).not.toContain('export interface PublicRole {')
  })
})

// ── Zod template (zero-change template) ─────────────────────────

describe('multi-schema: zod template', () => {
  it('uses schema-prefixed schema names', () => {
    const result = zod.generate(makeCtx('zod'))
    const content = result.files[0].content

    // camelCase of PascalCase names: toCamelCase('AuthUser') -> 'authuser'
    expect(content).toContain('authuserSchema')
    expect(content).toContain('coreprojectSchema')
    expect(content).toContain('coreroleSchema')
    expect(content).toContain('export type AuthUser =')
    expect(content).toContain('export type CoreProject =')
    expect(content).toContain('export type CoreRole =')
  })
})

// ── Drizzle template (SQL-name template, updated in Plan 02) ────

describe('multi-schema: drizzle template', () => {
  it('uses pgSchema for non-default schemas', () => {
    const result = drizzle.generate(makeCtx('drizzle'))
    const content = result.files[0].content

    // Should declare pgSchema constants for non-default schemas
    expect(content).toContain("pgSchema('auth')")
    expect(content).toContain("pgSchema('core')")

    // Should use schemaVar.table() instead of pgTable() for non-default schemas
    expect(content).toContain("authSchema.table('users'")
    expect(content).toContain("coreSchema.table('projects'")
    expect(content).toContain("coreSchema.table('roles'")

    // Should NOT use pgTable with schema-qualified names
    expect(content).not.toContain("pgTable('auth.users'")
    expect(content).not.toContain("pgTable('core.projects'")
    expect(content).not.toContain("pgTable('core.roles'")
  })

  it('cross-schema FK references resolve correctly', () => {
    const result = drizzle.generate(makeCtx('drizzle'))
    const content = result.files[0].content

    // core.projects.owner_id references auth.users.id
    // toCamelCase('AuthUser') -> 'authuser'
    expect(content).toContain('.references(() => authuser.id)')

    // auth.users.role_id references core.roles.id
    // toCamelCase('CoreRole') -> 'corerole'
    expect(content).toContain('.references(() => corerole.id)')
  })
})

// ── Knex template (SQL-name template, updated in Plan 02) ───────

describe('multi-schema: knex template', () => {
  it('uses schema-qualified table name keys', () => {
    const result = knex.generate(makeCtx('knex'))
    const content = result.files[0].content

    expect(content).toContain("'auth.users': AuthUserTable")
    expect(content).toContain("'core.projects': CoreProjectTable")
    expect(content).toContain("'core.roles': CoreRoleTable")
  })
})

// ── stripSchemaFromName tests ────────────────────────────────────

describe('multi-schema: stripSchemaFromName', () => {
  it('strips schema prefix when stripSchemaFromName is true', () => {
    const result = typescript.generate(makeCtx('typescript', { stripSchemaFromName: true }))
    const content = result.files[0].content

    expect(content).toContain('export interface User {')
    expect(content).toContain('export interface Project {')
    expect(content).toContain('export interface Role {')
    // Must NOT contain schema-prefixed names
    expect(content).not.toContain('AuthUser')
    expect(content).not.toContain('CoreProject')
    expect(content).not.toContain('CoreRole')
  })
})
