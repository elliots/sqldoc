import { describe, expect, it } from '@sqldoc/test-utils'
import { parse, parseArgs } from '../parser.ts'

describe('parse', () => {
  it('extracts @import with single-quoted path', () => {
    const result = parse("-- @import './anon.ts'")
    expect(result.imports).toHaveLength(1)
    expect(result.imports[0].path).toBe('./anon.ts')
    expect(result.imports[0].line).toBe(0)
  })

  it('extracts @import with double-quoted path', () => {
    const result = parse('-- @import "./rls.ts"')
    expect(result.imports).toHaveLength(1)
    expect(result.imports[0].path).toBe('./rls.ts')
  })

  it('extracts multiple @import lines with correct line numbers', () => {
    const doc = `-- @import './anon.ts'\n-- @import './rls.ts'`
    const result = parse(doc)
    expect(result.imports).toHaveLength(2)
    expect(result.imports[0].line).toBe(0)
    expect(result.imports[0].path).toBe('./anon.ts')
    expect(result.imports[1].line).toBe(1)
    expect(result.imports[1].path).toBe('./rls.ts')
  })

  it('extracts namespace.tag(args) from comment line', () => {
    const result = parse('-- @anon.mask(type: email)')
    expect(result.tags).toHaveLength(1)
    expect(result.tags[0].namespace).toBe('anon')
    expect(result.tags[0].tag).toBe('mask')
    expect(result.tags[0].rawArgs).toBe('type: email')
  })

  it('extracts standalone namespace tag (no dot, no args)', () => {
    const result = parse('-- @searchable')
    expect(result.tags).toHaveLength(1)
    expect(result.tags[0].namespace).toBe('searchable')
    expect(result.tags[0].tag).toBe(null)
    expect(result.tags[0].rawArgs).toBe(null)
  })

  it('extracts namespace.tag with complex named args', () => {
    const result = parse("-- @rls.policy(name: 'users_read', check: true)")
    expect(result.tags).toHaveLength(1)
    expect(result.tags[0].namespace).toBe('rls')
    expect(result.tags[0].tag).toBe('policy')
    expect(result.tags[0].rawArgs).toBe("name: 'users_read', check: true")
  })

  it('ignores tags outside of comment lines', () => {
    const doc = `@anon.mask(type: email)\nCREATE TABLE users (\n  id BIGSERIAL\n);`
    const result = parse(doc)
    expect(result.tags).toHaveLength(0)
  })

  it('extracts multiple tags on consecutive comment lines with correct line numbers', () => {
    const doc = `-- @anon.mask(type: email)\n-- @searchable\nCREATE TABLE users (\n  id BIGSERIAL\n);`
    const result = parse(doc)
    expect(result.tags).toHaveLength(2)
    expect(result.tags[0].line).toBe(0)
    expect(result.tags[0].namespace).toBe('anon')
    expect(result.tags[1].line).toBe(1)
    expect(result.tags[1].namespace).toBe('searchable')
  })

  it('separates imports from tags (import not in tags array)', () => {
    const doc = `-- @import './foo.ts'\n-- @anon.mask`
    const result = parse(doc)
    expect(result.imports).toHaveLength(1)
    expect(result.tags).toHaveLength(1)
    expect(result.tags[0].namespace).toBe('anon')
  })

  it('sets correct position fields for namespace and tag spans', () => {
    const result = parse('-- @anon.mask(type: email)')
    const tag = result.tags[0]
    // "-- @anon.mask(type: email)"
    //     ^   = index 3 = startCol of full match (@anon.mask(...))
    //      ^^^^  namespace "anon" starts at 4 (after @)
    expect(tag.namespaceStart).toBe(4)
    expect(tag.namespaceEnd).toBe(8) // 4 + "anon".length
    expect(tag.tagStart).toBe(9) // after the dot
    expect(tag.tagEnd).toBe(13) // 9 + "mask".length
  })

  it('correctly handles import startCol and endCol', () => {
    const result = parse("-- @import './anon.ts'")
    expect(result.imports[0].startCol).toBe(0)
    expect(result.imports[0].endCol).toBe("-- @import './anon.ts'".length)
  })

  it('handles a realistic multi-line SQL document', () => {
    const doc = `-- @import './anon.ts'
-- @anon.mask(type: email)
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL
);`
    const result = parse(doc)
    expect(result.imports).toHaveLength(1)
    expect(result.imports[0].path).toBe('./anon.ts')
    expect(result.tags).toHaveLength(1)
    expect(result.tags[0].namespace).toBe('anon')
    expect(result.tags[0].tag).toBe('mask')
    expect(result.tags[0].line).toBe(1)
  })

  it('returns empty results for plain SQL with no tags or imports', () => {
    const doc = `CREATE TABLE users (\n  id BIGSERIAL\n);`
    const result = parse(doc)
    expect(result.imports).toHaveLength(0)
    expect(result.tags).toHaveLength(0)
  })

  it('correctly sets argsStart and argsEnd for tag arguments', () => {
    const result = parse('-- @anon.mask(type: email)')
    const tag = result.tags[0]
    expect(tag.rawArgs).toBe('type: email')
    // argsStart should be the index right after '('
    // argsEnd should be argsStart + rawArgs.length
    expect(tag.argsEnd - tag.argsStart).toBe('type: email'.length)
  })
})

describe('parseArgs', () => {
  it('parses named args with string value', () => {
    const result = parseArgs('type: email')
    expect(result.type).toBe('named')
    expect(result.values).toEqual({ type: 'email' })
  })

  it('parses positional args (comma-separated)', () => {
    const result = parseArgs('email, name')
    expect(result.type).toBe('positional')
    expect(result.values).toEqual(['email', 'name'])
  })

  it('parses named args with numeric value', () => {
    const result = parseArgs('count: 42')
    expect(result.type).toBe('named')
    expect(result.values).toEqual({ count: 42 })
  })

  it('parses named args with boolean value', () => {
    const result = parseArgs('enabled: true')
    expect(result.type).toBe('named')
    expect(result.values).toEqual({ enabled: true })
  })

  it('parses positional array arg', () => {
    const result = parseArgs('[a, b, c]')
    expect(result.type).toBe('positional')
    expect(result.values).toEqual([['a', 'b', 'c']])
  })

  it('returns empty positional for empty string', () => {
    const result = parseArgs('')
    expect(result.type).toBe('positional')
    expect(result.values).toEqual([])
  })

  it('strips quotes from quoted string values', () => {
    const result = parseArgs("'hello'")
    expect(result.type).toBe('positional')
    expect(result.values).toEqual(['hello'])
  })
})
