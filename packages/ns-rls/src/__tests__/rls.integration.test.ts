/**
 * Integration tests for ns-rls.
 *
 * Generates RLS SQL, executes against real Postgres,
 * then verifies policies filter rows correctly.
 * RLS is Postgres-only.
 */

import { makeTagCtx } from '@sqldoc/core/test'
import { createAdapter, type DatabaseAdapter } from '@sqldoc/db'
import { after, describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('ns-rls integration - Postgres', () => {
  let db: DatabaseAdapter

  after(async () => {
    await db?.close()
  })

  it('ENABLE RLS + policy restricts access', async () => {
    db = await createAdapter({ engine: 'postgres' })

    // Create table and a test role
    await db.exec('CREATE TABLE documents (id SERIAL PRIMARY KEY, owner TEXT NOT NULL, content TEXT)')
    await db.exec('CREATE ROLE test_user')
    await db.exec('GRANT SELECT, INSERT ON documents TO test_user')

    // Generate and apply RLS SQL
    const enableResult = plugin.onTag!(
      makeTagCtx({ dialect: 'postgres', objectName: 'documents', tag: { name: null, args: {} } }),
    ) as any
    for (const s of enableResult.sql) await db.exec(s.sql)

    // Create a policy: users can only see their own rows
    const policyResult = plugin.onTag!(
      makeTagCtx({
        dialect: 'postgres',
        objectName: 'documents',
        tag: {
          name: 'policy',
          args: { for: 'SELECT', to: 'test_user', using: 'owner = current_user' },
        },
        namespaceTags: [{ tag: null, args: {} }],
        siblingTags: [{ namespace: 'rls', tag: null, args: {} }],
      }),
    ) as any
    for (const s of policyResult.sql) await db.exec(s.sql)

    // Insert data as superuser
    await db.exec("INSERT INTO documents (owner, content) VALUES ('test_user', 'secret doc')")
    await db.exec("INSERT INTO documents (owner, content) VALUES ('other_user', 'other doc')")

    // Superuser sees all
    const allDocs = await db.query('SELECT content FROM documents ORDER BY id')
    expect(allDocs.rows).toHaveLength(2)

    // Switch to test_user — should only see their own documents
    await db.exec('SET ROLE test_user')
    try {
      const userDocs = await db.query('SELECT content FROM documents ORDER BY id')
      expect(userDocs.rows).toHaveLength(1)
      expect(userDocs.rows[0][0]).toBe('secret doc')
    } finally {
      await db.exec('RESET ROLE')
    }
  })

  it('RLS is actually enabled on the table', async () => {
    const result = await db.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'documents'")
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0][0]).toBe(true)
  })
})
