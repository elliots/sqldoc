/**
 * Integration test for @sqldoc/templates/typeorm
 * Connects to real Postgres, verifies generated entities work with actual data.
 */
import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { User } from './users.entity.ts'
import { ContentPost } from './posts.entity.ts'
import { Comment } from './comments.entity.ts'
import { PostTag } from './post-tags.entity.ts'

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
  const ds = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    entities: [User, ContentPost, Comment, PostTag],
    synchronize: false,
  })

  await ds.initialize()

  try {
    console.log('--- typeorm integration test ---')

    // 1. Query known seeded user via Repository API
    const userRepo = ds.getRepository(User)
    const user = await userRepo.findOneBy({ id: '1' })
    assert(user !== null, 'seeded user found')
    assert(user!.email === 'test@example.com', 'user email matches')
    assert(user!.name === 'Test User', 'user name matches')
    assert(user!.age === 30, 'user age matches')
    assert(user!.isActive === true, 'user is_active matches')

    // 2. Query known seeded post (in content schema)
    const postRepo = ds.getRepository(ContentPost)
    const post = await postRepo.findOneBy({ id: '1' })
    assert(post !== null, 'seeded post found')
    assert(post!.title === 'Hello World', 'post title matches')
    assert(post!.body === 'First post body', 'post body matches')
    assert(post!.viewCount === 42, 'post view_count matches')
    assert(post!.rating === 4.5, 'post rating matches')

    // 3. Query comment with user relation loaded
    const commentRepo = ds.getRepository(Comment)
    const comment = await commentRepo.findOne({
      where: { id: '1' },
      relations: ['user'],
    })
    assert(comment !== null, 'seeded comment found')
    assert(comment!.content === 'Great post!', 'comment content matches')
    assert(comment!.user.email === 'test@example.com', 'comment -> user relation loaded')

    // 4. Query user with posts relation (cross-schema)
    const userWithPosts = await userRepo.findOne({
      where: { id: '1' },
      relations: ['posts'],
    })
    assert(userWithPosts !== null, 'user with posts found')
    assert(userWithPosts!.posts.length >= 1, 'user has posts')
    assert(userWithPosts!.posts[0].title === 'Hello World', 'user -> post relation loaded')

    if (failed > 0) {
      console.error(`\n${failed} assertion(s) failed`)
      process.exit(1)
    }
    console.log('\nAll assertions passed!')
  } finally {
    await ds.destroy()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
