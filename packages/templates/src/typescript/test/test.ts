/**
 * Integration test for @sqldoc/templates/typescript
 * Connects to real Postgres, verifies generated types work with actual data.
 */
import { Client } from 'pg'
// Import the generated type -- file is copied from codegen output at test time
import type { User, ContentPost } from './models.ts'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const client = new Client(DATABASE_URL)

let failed = 0
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`)
    failed++
  } else {
    console.log(`  ok: ${msg}`)
  }
}

async function run() {
  await client.connect()

  try {
    console.log('--- typescript integration test ---')

    // 1. Query known seeded user
    const { rows: userRows } = await client.query('SELECT * FROM users WHERE id = 1')
    const user = userRows[0]
    assert(user.email === 'test@example.com', 'user email matches')
    assert(user.name === 'Test User', 'user name matches')
    assert(user.age === 30, 'user age matches')
    assert(user.is_active === true, 'user is_active matches')

    // Verify the type is assignable (compile-time check; runtime confirms shape)
    const _typedUser: Partial<User> = {
      id: Number(user.id),
      email: user.email,
      name: user.name,
      age: user.age,
      isActive: user.is_active,
    }
    assert(typeof _typedUser.email === 'string', 'typed user email is string')

    // 2. Query known seeded post
    const { rows: postRows } = await client.query('SELECT * FROM content.posts WHERE id = 1')
    assert(postRows.length === 1, 'seeded post found')
    assert(postRows[0].title === 'Hello World', 'post title matches')

    // Verify ContentPost type assignability
    const _typedPost: Partial<ContentPost> = {
      id: Number(postRows[0].id),
      title: postRows[0].title,
      body: postRows[0].body,
    }
    assert(typeof _typedPost.title === 'string', 'typed post title is string')

    // 3. Insert a new post
    await client.query(
      "INSERT INTO content.posts (user_id, title, body, view_count) VALUES (1, 'Post from typescript', 'test body', 0)",
    )

    // 4. Read it back
    const { rows: newPosts } = await client.query("SELECT * FROM content.posts WHERE title = 'Post from typescript'")
    assert(newPosts.length === 1, 'inserted post found')
    assert(newPosts[0].title === 'Post from typescript', 'inserted post title matches')
    // pg returns bigint columns as strings; use Number() for comparison
    assert(Number(newPosts[0].user_id) === 1, 'inserted post user_id matches')

    if (failed > 0) {
      console.error(`\n${failed} assertion(s) failed`)
      process.exit(1)
    }
    console.log('\nAll assertions passed!')
  } finally {
    await client.end()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
