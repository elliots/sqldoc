/**
 * Integration test for @sqldoc/templates/kysely
 * Connects to real Postgres via Kysely, verifies generated Database interface works.
 */
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { getUserPosts, type Database } from './database.ts'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: DATABASE_URL }),
  }),
})

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
    console.log('--- kysely integration test ---')

    // 1. Query known seeded user using Kysely's type-safe query builder
    const user = await db.selectFrom('users').selectAll().where('id', '=', 1).executeTakeFirstOrThrow()

    assert(user.email === 'test@example.com', 'user email matches')
    assert(user.name === 'Test User', 'user name matches')
    assert(user.is_active === true, 'user is_active matches')

    // 2. Query known seeded post
    const post = await db.selectFrom('content.posts').selectAll().where('id', '=', 1).executeTakeFirstOrThrow()

    assert(post.title === 'Hello World', 'post title matches')

    // 3. Insert a new post via type-safe insert
    await db
      .insertInto('content.posts')
      .values({
        user_id: 1,
        title: 'Post from kysely',
        body: 'test body',
        view_count: 0,
      })
      .execute()

    // 4. Read it back
    const newPost = await db
      .selectFrom('content.posts')
      .selectAll()
      .where('title', '=', 'Post from kysely')
      .executeTakeFirstOrThrow()

    assert(newPost.title === 'Post from kysely', 'inserted post title matches')
    // pg returns bigint columns as strings; use loose equality for numeric comparison
    assert(Number(newPost.user_id) === 1, 'inserted post user_id matches')

    // 5. Call generated function helper — getUserPosts returns SETOF content.posts
    const userPosts = await getUserPosts(db, 1)
    assert(userPosts.length >= 1, 'getUserPosts returns posts')
    assert(userPosts[0].title === 'Hello World', 'getUserPosts returns seeded post')

    if (failed > 0) {
      console.error(`\n${failed} assertion(s) failed`)
      process.exit(1)
    }
    console.log('\nAll assertions passed!')
  } finally {
    await db.destroy()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
