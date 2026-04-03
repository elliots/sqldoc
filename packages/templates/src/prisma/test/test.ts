/**
 * Integration test for @sqldoc/templates/prisma
 * Connects to real Postgres via Prisma Client, verifies generated schema works.
 */
import { PrismaClient } from '@prisma/client'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

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
  const prisma = new PrismaClient()

  try {
    console.log('--- prisma integration test ---')

    // 1. Query known seeded user
    const user = await prisma.user.findFirst({ where: { id: 1n } })
    assert(user !== null, 'seeded user found')
    assert(user!.email === 'test@example.com', 'user email matches')
    assert(user!.name === 'Test User', 'user name matches')
    assert(user!.age === 30, 'user age matches')
    assert(user!.is_active === true, 'user is_active matches')

    // 2. Query known seeded post (content schema)
    const post = await prisma.contentPost.findFirst({ where: { id: 1n } })
    assert(post !== null, 'seeded post found')
    assert(post!.title === 'Hello World', 'post title matches')
    assert(post!.body === 'First post body', 'post body matches')
    assert(post!.view_count === 42, 'post view_count matches')
    assert(post!.rating === 4.5, 'post rating matches')

    // 3. Query known seeded comment
    const comment = await prisma.comment.findFirst({ where: { id: 1n } })
    assert(comment !== null, 'seeded comment found')
    assert(comment!.content === 'Great post!', 'comment content matches')

    // 4. Query user with posts relation (cross-schema)
    const userWithPosts = await prisma.user.findFirst({
      where: { id: 1n },
      include: { posts: true },
    })
    assert(userWithPosts !== null, 'user with posts found')
    assert(userWithPosts!.posts.length >= 1, 'user has posts')
    assert(userWithPosts!.posts[0].title === 'Hello World', 'user -> post relation loaded')

    // 5. Query comment with user relation
    const commentWithUser = await prisma.comment.findFirst({
      where: { id: 1n },
      include: { user: true },
    })
    assert(commentWithUser !== null, 'comment with user found')
    assert(commentWithUser!.user.email === 'test@example.com', 'comment -> user relation loaded')

    if (failed > 0) {
      console.error(`\n${failed} assertion(s) failed`)
      process.exit(1)
    }
    console.log('\nAll assertions passed!')
  } finally {
    await prisma.$disconnect()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
