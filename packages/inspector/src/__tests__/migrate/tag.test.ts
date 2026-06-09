import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import { scanStmts } from '../../migrate/lex.ts'
import { extractTagsFromStmts, parseStmtTags, parseTableName, parseTags, stmtTags } from '../../migrate/tag.ts'

describe('parseTags', () => {
  it('returns empty for no comments', () => {
    const tags = parseTags([])
    assert.equal(tags.length, 0)
  })

  it('returns empty for comments without tags', () => {
    const tags = parseTags(['-- just a comment\n'])
    assert.equal(tags.length, 0)
  })

  it('extracts simple tag', () => {
    const tags = parseTags(['-- @audit.tracked\n'])
    assert.equal(tags.length, 1)
    assert.equal(tags[0].name, 'audit.tracked')
    assert.equal(tags[0].args, '')
  })

  it('extracts tag with args', () => {
    const tags = parseTags(['-- @audit.log(on: [update, delete])\n'])
    assert.equal(tags.length, 1)
    assert.equal(tags[0].name, 'audit.log')
    assert.equal(tags[0].args, 'on: [update, delete]')
  })

  it('extracts multiple tags on one line', () => {
    const tags = parseTags(['-- @gql.filter @gql.order\n'])
    assert.equal(tags.length, 2)
    assert.equal(tags[0].name, 'gql.filter')
    assert.equal(tags[1].name, 'gql.order')
  })

  it('extracts tags from multiple comment lines', () => {
    const tags = parseTags([
      '-- @tenant.global\n',
      '-- @audit.tracked\n',
      '-- @gql.expose("Tenant", behaviors: [select, single], simpleCollections: true)\n',
    ])
    assert.equal(tags.length, 3)
    assert.equal(tags[0].name, 'tenant.global')
    assert.equal(tags[1].name, 'audit.tracked')
    assert.equal(tags[2].name, 'gql.expose')
    assert.equal(tags[2].args, '"Tenant", behaviors: [select, single], simpleCollections: true')
  })

  it('extracts tag without namespace', () => {
    const tags = parseTags(['-- @deprecated\n'])
    assert.equal(tags.length, 1)
    assert.equal(tags[0].name, 'deprecated')
  })

  it('extracts deeply nested namespace', () => {
    const tags = parseTags(['-- @a.b.c.d\n'])
    assert.equal(tags.length, 1)
    assert.equal(tags[0].name, 'a.b.c.d')
  })

  it('extracts from block comments', () => {
    const tags = parseTags(['/* @audit.tracked */'])
    assert.equal(tags.length, 1)
    assert.equal(tags[0].name, 'audit.tracked')
  })

  it('extracts from hash comments', () => {
    const tags = parseTags(['# @audit.tracked\n'])
    assert.equal(tags.length, 1)
    assert.equal(tags[0].name, 'audit.tracked')
  })

  it('extracts rbac with named args', () => {
    const tags = parseTags(['-- @rbac(admin: all, installer: select, customer: select, readonly: select)\n'])
    assert.equal(tags.length, 1)
    assert.equal(tags[0].name, 'rbac')
    assert.equal(tags[0].args, 'admin: all, installer: select, customer: select, readonly: select')
  })
})

describe('stmtTags', () => {
  it('returns tags from a Stmt comments', () => {
    const tags = stmtTags({
      pos: 0,
      text: 'CREATE TABLE tenant ();',
      comments: ['-- @tenant.global\n', '-- @audit.tracked\n'],
    })
    assert.equal(tags.length, 2)
    assert.equal(tags[0].name, 'tenant.global')
    assert.equal(tags[1].name, 'audit.tracked')
  })
})

describe('parseStmtTags', () => {
  it('extracts column-level tags from CREATE TABLE', () => {
    const stmt = `CREATE TABLE public.tenant (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- @gql.filter @gql.order
    name text NOT NULL UNIQUE,

    slug citext NOT NULL UNIQUE,

    -- @gql.omit
    stripe_customer_id text,

    -- @gql.omit
    subscription_tier text NOT NULL DEFAULT 'free'
        CHECK (subscription_tier IN ('free', 'starter', 'professional', 'enterprise')),

    is_active boolean NOT NULL DEFAULT true
);`
    const { columnTags, tableTags } = parseStmtTags(stmt)
    assert.equal(tableTags.length, 0)

    const nameTags = columnTags.get('name')!
    assert.equal(nameTags.length, 2)
    assert.equal(nameTags[0].name, 'gql.filter')
    assert.equal(nameTags[1].name, 'gql.order')

    const stripeTags = columnTags.get('stripe_customer_id')!
    assert.equal(stripeTags.length, 1)
    assert.equal(stripeTags[0].name, 'gql.omit')

    const subTags = columnTags.get('subscription_tier')!
    assert.equal(subTags.length, 1)
    assert.equal(subTags[0].name, 'gql.omit')

    assert.equal(columnTags.has('id'), false)
    assert.equal(columnTags.has('slug'), false)
    assert.equal(columnTags.has('is_active'), false)
  })

  it('handles user example with all tag placement patterns', () => {
    const stmt = `-- @for("one")
create table one ( -- @for("one again")

    -- @for("two")
    two text, -- @for("two again")
    three text, -- @for("three")

    -- @for("four")


four numeric

    -- @for("one yet again")

)`
    const { columnTags, tableTags } = parseStmtTags(stmt)

    assert.equal(tableTags.length, 3)
    assert.equal(tableTags[0].args, '"one"')
    assert.equal(tableTags[1].args, '"one again"')
    assert.equal(tableTags[2].args, '"one yet again"')

    const twoTags = columnTags.get('two')!
    assert.equal(twoTags.length, 2)
    assert.equal(twoTags[0].args, '"two"')
    assert.equal(twoTags[1].args, '"two again"')

    const threeTags = columnTags.get('three')!
    assert.equal(threeTags.length, 1)
    assert.equal(threeTags[0].args, '"three"')

    const fourTags = columnTags.get('four')!
    assert.equal(fourTags.length, 1)
    assert.equal(fourTags[0].args, '"four"')
  })

  it('handles quoted column names', () => {
    const stmt = `CREATE TABLE test (
    -- @pii
    "user name" text NOT NULL
);`
    const { columnTags, tableTags } = parseStmtTags(stmt)
    assert.equal(tableTags.length, 0)
    const userNameTags = columnTags.get('user name')!
    assert.equal(userNameTags.length, 1)
    assert.equal(userNameTags[0].name, 'pii')
  })

  it('returns empty for no tags', () => {
    const stmt = `CREATE TABLE test (
    id bigserial PRIMARY KEY,
    name text NOT NULL
);`
    const { columnTags, tableTags } = parseStmtTags(stmt)
    assert.equal(tableTags.length, 0)
    assert.equal(columnTags.size, 0)
  })
})

describe('parseTableName', () => {
  it('extracts simple table name', () => {
    const { schema, table } = parseTableName('CREATE TABLE tenant (id int);')
    assert.equal(schema, '')
    assert.equal(table, 'tenant')
  })

  it('extracts schema-qualified table name', () => {
    const { schema, table } = parseTableName('CREATE TABLE public.tenant (id int);')
    assert.equal(schema, 'public')
    assert.equal(table, 'tenant')
  })

  it('handles IF NOT EXISTS', () => {
    const { schema, table } = parseTableName('create table IF NOT EXISTS public.users (id int);')
    assert.equal(schema, 'public')
    assert.equal(table, 'users')
  })

  it('handles quoted identifiers', () => {
    const { schema, table } = parseTableName('CREATE TABLE "my schema"."my table" (id int);')
    assert.equal(schema, 'my schema')
    assert.equal(table, 'my table')
  })

  it('returns empty for non-CREATE TABLE', () => {
    assert.equal(parseTableName('ALTER TABLE tenant ADD COLUMN x int;').table, '')
    assert.equal(parseTableName('SELECT 1;').table, '')
  })
})

describe('extractTagsFromStmts', () => {
  it('builds tag index from SQL statements', () => {
    const input = `-- @audit.tracked
CREATE TABLE public.tenant (
    -- @gql.filter
    name text NOT NULL
);`
    const stmtList = scanStmts(input)
    const idx = extractTagsFromStmts(stmtList)

    const tableTags = idx.tableTags.get('public.tenant')
    assert.ok(tableTags)
    assert.equal(tableTags[0].name, 'audit.tracked')

    const colTags = idx.columnTags.get('public.tenant.name')
    assert.ok(colTags)
    assert.equal(colTags[0].name, 'gql.filter')
  })
})
