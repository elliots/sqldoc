/**
 * Integration test for @sqldoc/templates/drizzle
 * Connects to real Postgres via drizzle-orm, verifies generated schema works.
 *
 * The generated schema uses pgSchema('content').table('posts', ...) for tables
 * in the "content" schema, so drizzle correctly schema-qualifies queries as
 * "content"."posts". All tables use the type-safe drizzle query builder.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema.ts'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const sql = postgres(DATABASE_URL)
const db = drizzle(sql, { schema })

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
  try {
    console.log('--- drizzle integration test ---')

    // 1. Query known seeded user via type-safe drizzle query builder
    const users = await db.select().from(schema.user).where(eq(schema.user.id, 1))
    assert(users.length === 1, 'seeded user found')
    assert(users[0].email === 'test@example.com', 'user email matches')
    assert(users[0].name === 'Test User', 'user name matches')

    // 2. Query known seeded post (content schema — pgSchema properly qualifies)
    const posts = await db.select().from(schema.contentpost).where(eq(schema.contentpost.id, 1))
    assert(posts.length === 1, 'seeded post found')
    assert(posts[0].title === 'Hello World', 'post title matches')

    // 3. Insert a new post via type-safe drizzle insert
    await db.insert(schema.contentpost).values({
      userId: 1,
      title: 'Post from drizzle',
      body: 'test body',
      viewCount: 0,
    })

    // 4. Read it back
    const newPosts = await db
      .select()
      .from(schema.contentpost)
      .where(eq(schema.contentpost.title, 'Post from drizzle'))
    assert(newPosts.length === 1, 'inserted post found')
    assert(newPosts[0].title === 'Post from drizzle', 'inserted post title matches')
    assert(Number(newPosts[0].userId) === 1, 'inserted post user_id matches')

    // 5. Verify the generated table definitions are importable and have correct shape
    assert(typeof schema.contentpost === 'object', 'contentpost table definition exists')
    assert(typeof schema.user === 'object', 'user table definition exists')
    assert(typeof schema.comment === 'object', 'comment table definition exists')
    assert(typeof schema.contentSchema === 'object', 'contentSchema pgSchema definition exists')

    if (failed > 0) {
      console.error(`\n${failed} assertion(s) failed`)
      process.exit(1)
    }
    console.log('\nAll assertions passed!')
  } finally {
    await sql.end()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
