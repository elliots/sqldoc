/**
 * Integration test for @sqldoc/templates/knex
 * Connects to real Postgres via Knex, verifies generated table types work.
 */
import knex from 'knex'
// Import to ensure the module augmentation is loaded
import type {} from './database.ts'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const db = knex({
  client: 'pg',
  connection: DATABASE_URL,
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
    console.log('--- knex integration test ---')

    // 1. Query known seeded user using Knex's type-safe table method
    const users = await db('users').where({ id: 1 })
    const user = users[0]

    assert(user.email === 'test@example.com', 'user email matches')
    assert(user.name === 'Test User', 'user name matches')
    assert(user.is_active === true, 'user is_active matches')

    // 2. Query known seeded post
    const posts = await db('content.posts').where({ id: 1 })
    assert(posts.length === 1, 'seeded post found')
    assert(posts[0].title === 'Hello World', 'post title matches')

    // 3. Insert a new post
    await db('content.posts').insert({
      user_id: 1,
      title: 'Post from knex',
      body: 'test body',
      view_count: 0,
    })

    // 4. Read it back
    const newPosts = await db('content.posts').where({ title: 'Post from knex' })
    assert(newPosts.length === 1, 'inserted post found')
    assert(newPosts[0].title === 'Post from knex', 'inserted post title matches')
    // pg returns bigint columns as strings; use Number() for comparison
    assert(Number(newPosts[0].user_id) === 1, 'inserted post user_id matches')

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
