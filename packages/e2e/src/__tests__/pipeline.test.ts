import * as fs from 'node:fs'
import * as path from 'node:path'
import type { NamespacePlugin } from '@sqldoc/core'
import { compile, loadImports, parse, SqlparserTsAdapter } from '@sqldoc/core'
import { beforeAll, describe, expect, it } from 'vitest'

const fixturesDir = path.join(__dirname, 'fixtures')

function readFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf-8')
}

describe('E2E: full compile pipeline', () => {
  let adapter: SqlparserTsAdapter

  beforeAll(async () => {
    adapter = new SqlparserTsAdapter('postgres')
    await adapter.init()
  })

  async function compileFixture(fixtureName: string) {
    const source = readFixture(fixtureName)
    const filePath = path.join(fixturesDir, fixtureName)
    const { imports } = parse(source)
    const { namespaces } = await loadImports(
      imports.map((i) => i.path),
      filePath,
    )
    const plugins = new Map<string, NamespacePlugin>([...namespaces].map(([k, v]) => [k, v as NamespacePlugin]))
    const statements = adapter.parseStatements(source)
    return compile({ source, filePath, plugins, statements, adapter, config: { dialect: 'postgres' } })
  }

  describe('ns-anon: anon-test.sql', () => {
    it('produces SECURITY LABEL statements for masked columns', async () => {
      const result = await compileFixture('anon-test.sql')

      expect(result.mergedSql).toContain('SECURITY LABEL FOR anon ON COLUMN "customers"."email"')
      expect(result.mergedSql).toContain('SECURITY LABEL FOR anon ON COLUMN "customers"."phone"')
    })

    it('produces SECURITY LABEL with correct function expressions', async () => {
      const result = await compileFixture('anon-test.sql')

      expect(result.mergedSql).toContain('MASKED WITH FUNCTION anon.fake_email()')
      expect(result.mergedSql).toContain('MASKED WITH FUNCTION anon.random_string(10)')
    })

    it('produces no errors', async () => {
      const result = await compileFixture('anon-test.sql')
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('ns-rls: rls-test.sql', () => {
    it('produces ALTER TABLE ENABLE ROW LEVEL SECURITY', async () => {
      const result = await compileFixture('rls-test.sql')

      expect(result.mergedSql).toContain('ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY')
      expect(result.mergedSql).toContain('ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY')
    })

    it('produces CREATE POLICY with correct parameters', async () => {
      const result = await compileFixture('rls-test.sql')

      expect(result.mergedSql).toContain('CREATE POLICY')
      expect(result.mergedSql).toContain('FOR SELECT')
      expect(result.mergedSql).toContain('TO authenticated')
      expect(result.mergedSql).toContain('USING (user_id = current_user_id())')
    })

    it('produces no errors', async () => {
      const result = await compileFixture('rls-test.sql')
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('combined: combined-test.sql', () => {
    it('produces both SECURITY LABEL and RLS', async () => {
      const result = await compileFixture('combined-test.sql')

      expect(result.mergedSql).toContain('SECURITY LABEL FOR anon ON COLUMN "profiles"."email"')
      expect(result.mergedSql).toContain('ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY')
      expect(result.mergedSql).toContain('CREATE POLICY')
    })

    it('produces no errors', async () => {
      const result = await compileFixture('combined-test.sql')
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('ns-audit: audit-test.sql', () => {
    it('produces trigger function and trigger', async () => {
      const result = await compileFixture('audit-test.sql')

      expect(result.mergedSql).toContain('CREATE OR REPLACE FUNCTION')
      expect(result.mergedSql).toContain('orders_audit_fn')
      expect(result.mergedSql).toContain('CREATE TRIGGER')
      expect(result.mergedSql).toContain('AFTER INSERT OR UPDATE OR DELETE')
    })

    it('produces no errors', async () => {
      const result = await compileFixture('audit-test.sql')
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('ns-comment: comment-test.sql', () => {
    it('produces COMMENT ON for table and columns', async () => {
      const result = await compileFixture('comment-test.sql')

      expect(result.mergedSql).toContain('Primary product catalog')
      expect(result.mergedSql).toContain('Product display name')
      expect(result.mergedSql).toContain('Price in cents to avoid floating point')
    })

    it('produces no errors', async () => {
      const result = await compileFixture('comment-test.sql')
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('ns-deprecated: deprecated-test.sql', () => {
    it('produces COMMENT ON with deprecation messages', async () => {
      const result = await compileFixture('deprecated-test.sql')

      expect(result.mergedSql).toContain('DEPRECATED')
      expect(result.mergedSql).toContain('use user_profiles instead')
      expect(result.mergedSql).toContain('scheduled for removal after 2025-12-01')
    })

    it('produces no errors', async () => {
      const result = await compileFixture('deprecated-test.sql')
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('ns-validate: validate-test.sql', () => {
    it('produces CHECK constraints', async () => {
      const result = await compileFixture('validate-test.sql')

      expect(result.mergedSql).toContain('ADD CONSTRAINT')
      expect(result.mergedSql).toContain('not_empty')
      expect(result.mergedSql).toContain('length')
      expect(result.mergedSql).toContain('range')
      expect(result.mergedSql).toContain('pattern')
    })

    it('produces no errors', async () => {
      const result = await compileFixture('validate-test.sql')
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('ns-postgraphile: postgraphile-test.sql', () => {
    it('produces PostGraphile smart comments', async () => {
      const result = await compileFixture('postgraphile-test.sql')

      expect(result.mergedSql).toContain('COMMENT ON')
      expect(result.mergedSql).toContain('@simpleCollections only')
      expect(result.mergedSql).toContain('@omit')
    })

    it('produces no errors', async () => {
      const result = await compileFixture('postgraphile-test.sql')
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('mergedSql format', () => {
    it('contains original source SQL before generated', async () => {
      const result = await compileFixture('anon-test.sql')

      expect(result.mergedSql).toContain('CREATE TABLE customers')
      expect(result.mergedSql.indexOf('CREATE TABLE customers')).toBeLessThan(
        result.mergedSql.indexOf('SECURITY LABEL'),
      )
    })

    it('contains "Generated by sqldoc" separator comment', async () => {
      const result = await compileFixture('anon-test.sql')
      expect(result.mergedSql).toContain('-- Generated by sqldoc')
    })
  })
})
