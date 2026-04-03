/**
 * Integration test for @sqldoc/templates/zod
 * Validates generated Zod schemas by parsing valid and invalid data.
 */
import {
  userSchema,
  contentpostSchema,
  commentSchema,
  posttagSchema,
  addressSchema,
  activeuserSchema,
} from './schemas.ts'

let failed = 0
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`)
    failed++
  } else {
    console.log(`  ok: ${msg}`)
  }
}

function assertThrows(fn: () => void, msg: string) {
  try {
    fn()
    console.error(`FAIL: ${msg} (did not throw)`)
    failed++
  } catch {
    console.log(`  ok: ${msg}`)
  }
}

console.log('--- zod integration test ---')

// -- userSchema: valid data --
const validUser = userSchema.parse({
  id: 1,
  email: 'test@example.com',
  name: 'Test User',
  age: 30,
  isActive: true,
  createdAt: new Date('2024-01-01T00:00:00Z'),
})
assert(validUser.id === 1, 'userSchema: id parsed')
assert(validUser.email === 'test@example.com', 'userSchema: email parsed')
assert(validUser.name === 'Test User', 'userSchema: name parsed')
assert(validUser.age === 30, 'userSchema: age parsed')
assert(validUser.isActive === true, 'userSchema: isActive parsed')

// -- userSchema: optional fields --
const minimalUser = userSchema.parse({
  id: 2,
  email: 'min@test.com',
  isActive: false,
  createdAt: new Date(),
})
assert(minimalUser.name === undefined, 'userSchema: optional name is undefined')
assert(minimalUser.age === undefined, 'userSchema: optional age is undefined')

// -- userSchema: invalid email --
assertThrows(
  () => userSchema.parse({ id: 1, email: 'bad-email', isActive: true, createdAt: new Date() }),
  'userSchema: rejects invalid email pattern',
)

// -- userSchema: age out of range --
assertThrows(
  () => userSchema.parse({ id: 1, email: 'a@b.c', isActive: true, createdAt: new Date(), age: 999 }),
  'userSchema: rejects age > 120',
)
assertThrows(
  () => userSchema.parse({ id: 1, email: 'a@b.c', isActive: true, createdAt: new Date(), age: -1 }),
  'userSchema: rejects age < 0',
)

// -- userSchema: missing required field --
assertThrows(
  () => userSchema.parse({ id: 1, email: 'a@b.c', createdAt: new Date() }),
  'userSchema: rejects missing isActive',
)

// -- contentpostSchema: valid data --
const validPost = contentpostSchema.parse({
  id: 1,
  userId: 1,
  title: 'Hello World',
  body: 'First post body',
  publishedAt: new Date('2024-01-01T00:00:00Z'),
  viewCount: 42,
  rating: 4.5,
})
assert(validPost.title === 'Hello World', 'contentpostSchema: title parsed')
assert(validPost.viewCount === 42, 'contentpostSchema: viewCount parsed')
assert(validPost.rating === 4.5, 'contentpostSchema: rating parsed')

// -- contentpostSchema: optional fields --
const minimalPost = contentpostSchema.parse({
  id: 2,
  userId: 1,
  title: 'No optional',
  body: 'body',
  viewCount: 0,
})
assert(minimalPost.publishedAt === undefined, 'contentpostSchema: optional publishedAt is undefined')
assert(minimalPost.rating === undefined, 'contentpostSchema: optional rating is undefined')

// -- contentpostSchema: missing required field --
assertThrows(
  () => contentpostSchema.parse({ id: 1, userId: 1, body: 'no title', viewCount: 0 }),
  'contentpostSchema: rejects missing title',
)

// -- commentSchema: valid data --
const validComment = commentSchema.parse({
  id: 1,
  postId: 1,
  userId: 1,
  content: 'Great post!',
  createdAt: new Date('2024-01-01T00:00:00Z'),
})
assert(validComment.content === 'Great post!', 'commentSchema: content parsed')
assert(validComment.parentId === undefined, 'commentSchema: optional parentId is undefined')

// -- posttagSchema --
const validTag = posttagSchema.parse({ postId: 1, tagId: 1 })
assert(validTag.postId === 1, 'posttagSchema: postId parsed')

// -- addressSchema --
const validAddr = addressSchema.parse({ street: '123 Main', city: 'Springfield', zip: '62701', country: 'US' })
assert(validAddr.city === 'Springfield', 'addressSchema: city parsed')

// -- activeuserSchema: all optional (view) --
const emptyActiveUser = activeuserSchema.parse({})
assert(emptyActiveUser.id === undefined, 'activeuserSchema: all fields optional')

const fullActiveUser = activeuserSchema.parse({
  id: 1,
  email: 'test@example.com',
  name: 'Test User',
  createdAt: new Date(),
})
assert(fullActiveUser.email === 'test@example.com', 'activeuserSchema: email parsed')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll assertions passed!')
