const Ajv = require('ajv/dist/2020')
const addFormats = require('ajv-formats')
const schema = require('./schema.json')

const ajv = new Ajv({ allErrors: true })
addFormats(ajv)

// Register all $defs as schemas so $ref works
for (const [name, def] of Object.entries(schema.$defs || {})) {
  ajv.addSchema(def, `#/$defs/${name}`)
}

let passed = 0
let failed = 0

function assert(condition, msg) {
  if (condition) {
    console.log('  PASS:', msg)
    passed++
  } else {
    console.error('  FAIL:', msg)
    failed++
  }
}

function validateData(schemaName, data) {
  const validate = ajv.compile(schema.$defs[schemaName])
  return validate(data)
}

function getErrors(schemaName, data) {
  const validate = ajv.compile(schema.$defs[schemaName])
  validate(data)
  return validate.errors
}

// --- User ---
console.log('User:')
const validUser = {
  id: 1,
  email: 'alice@example.com',
  name: 'Alice',
  age: 30,
  is_active: true,
  created_at: '2024-01-15T10:30:00Z',
  tags: ['admin', 'editor'],
  balance: 99.95,
  external_id: '550e8400-e29b-41d4-a716-446655440000'
}
assert(validateData('User', validUser), 'valid user accepted')

// Missing required field (email)
const missingEmail = { id: 2, is_active: true, created_at: '2024-01-15T10:30:00Z' }
assert(!validateData('User', missingEmail), 'user missing email rejected')

// Invalid email pattern
const badEmail = { id: 3, email: 'not-an-email', is_active: true, created_at: '2024-01-15T10:30:00Z' }
assert(!validateData('User', badEmail), 'user with bad email rejected')

// Age out of range
const badAge = { id: 4, email: 'bob@example.com', is_active: true, created_at: '2024-01-15T10:30:00Z', age: 200 }
assert(!validateData('User', badAge), 'user with age > 120 rejected')

// Wrong type for is_active
const wrongType = { id: 5, email: 'bob@example.com', is_active: 'yes', created_at: '2024-01-15T10:30:00Z' }
assert(!validateData('User', wrongType), 'user with string is_active rejected')

// --- ContentPost ---
console.log('ContentPost:')
const validPost = {
  id: 1,
  user_id: 1,
  title: 'Hello World',
  body: 'This is my first post.',
  published_at: '2024-06-01T12:00:00Z',
  view_count: 42,
  rating: 4.5
}
assert(validateData('ContentPost', validPost), 'valid post accepted')

// Missing required title
const missingTitle = { id: 2, user_id: 1, body: 'No title', view_count: 0 }
assert(!validateData('ContentPost', missingTitle), 'post missing title rejected')

// Optional fields omitted
const minimalPost = { id: 3, user_id: 1, title: 'Minimal', body: 'Just required fields', view_count: 0 }
assert(validateData('ContentPost', minimalPost), 'minimal post (no optional fields) accepted')

// --- Comment ---
console.log('Comment:')
const validComment = {
  id: 1,
  post_id: 1,
  user_id: 1,
  content: 'Great post!',
  created_at: '2024-06-02T08:00:00Z'
}
assert(validateData('Comment', validComment), 'valid comment accepted')

// With optional parent_id
const reply = {
  id: 2,
  post_id: 1,
  user_id: 2,
  parent_id: 1,
  content: 'Thanks!',
  created_at: '2024-06-02T09:00:00Z'
}
assert(validateData('Comment', reply), 'reply with parent_id accepted')

// Missing required content
const noContent = { id: 3, post_id: 1, user_id: 1, created_at: '2024-06-02T10:00:00Z' }
assert(!validateData('Comment', noContent), 'comment missing content rejected')

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
