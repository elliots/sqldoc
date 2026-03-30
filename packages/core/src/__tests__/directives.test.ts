/**
 * Tests for @external and @include directive parsing.
 */

import { describe, expect, it } from '@sqldoc/test-utils'
import { EXTERNAL_RE, INCLUDE_RE, parseDirectives } from '../directives.ts'
import { parse } from '../parser.ts'

describe('parseDirectives', () => {
  it('parses @external with single-quoted path', () => {
    const result = parseDirectives("-- @external './base.sql'")
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('external')
    expect(result[0].path).toBe('./base.sql')
    expect(result[0].line).toBe(0)
  })

  it('parses @include with single-quoted path', () => {
    const result = parseDirectives("-- @include './extra.sql'")
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('include')
    expect(result[0].path).toBe('./extra.sql')
    expect(result[0].line).toBe(0)
  })

  it('parses @external with double-quoted path', () => {
    const result = parseDirectives('-- @external "./schemas/*.sql"')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('external')
    expect(result[0].path).toBe('./schemas/*.sql')
  })

  it('returns empty array when no directives present', () => {
    const result = parseDirectives('CREATE TABLE users (id BIGSERIAL);')
    expect(result).toHaveLength(0)
  })

  it('returns empty for text with only @import directives', () => {
    const result = parseDirectives("-- @import './anon.ts'")
    expect(result).toHaveLength(0)
  })

  it('parses multiple directives on separate lines', () => {
    const text = "-- @external './base.sql'\n-- @include './extra.sql'"
    const result = parseDirectives(text)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('external')
    expect(result[0].path).toBe('./base.sql')
    expect(result[0].line).toBe(0)
    expect(result[1].type).toBe('include')
    expect(result[1].path).toBe('./extra.sql')
    expect(result[1].line).toBe(1)
  })

  it('ignores @external/@include mixed with other lines', () => {
    const text = `-- @import './anon.ts'
-- @external './base.sql'
CREATE TABLE users (id BIGSERIAL);
-- @include './extra.sql'`
    const result = parseDirectives(text)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('external')
    expect(result[0].path).toBe('./base.sql')
    expect(result[0].line).toBe(1)
    expect(result[1].type).toBe('include')
    expect(result[1].path).toBe('./extra.sql')
    expect(result[1].line).toBe(3)
  })

  it('sets correct startCol and endCol', () => {
    const result = parseDirectives("-- @external './base.sql'")
    const d = result[0]
    expect(d.startCol).toBe(0)
    expect(d.endCol).toBe("-- @external './base.sql'".length)
  })

  it('handles glob patterns in paths', () => {
    const result = parseDirectives("-- @external './schemas/**/*.sql'")
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('./schemas/**/*.sql')
  })

  it('handles extra whitespace between -- and @', () => {
    const result = parseDirectives("--   @external './base.sql'")
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('external')
    expect(result[0].path).toBe('./base.sql')
  })
})

describe('EXTERNAL_RE and INCLUDE_RE', () => {
  it('EXTERNAL_RE matches @external directive', () => {
    EXTERNAL_RE.lastIndex = 0
    const m = EXTERNAL_RE.exec("-- @external './base.sql'")
    expect(m).toBeTruthy()
    expect(m![2]).toBe('./base.sql')
  })

  it('INCLUDE_RE matches @include directive', () => {
    INCLUDE_RE.lastIndex = 0
    const m = INCLUDE_RE.exec("-- @include './extra.sql'")
    expect(m).toBeTruthy()
    expect(m![2]).toBe('./extra.sql')
  })
})

describe('parse() integration with directives', () => {
  it('returns externals and includes arrays in ParseResult', () => {
    const text = `-- @external './base.sql'
-- @include './extra.sql'
-- @import './anon.ts'
-- @anon.mask(type: email)
CREATE TABLE users (id BIGSERIAL);`
    const result = parse(text)
    expect(result.externals).toHaveLength(1)
    expect(result.externals[0].type).toBe('external')
    expect(result.externals[0].path).toBe('./base.sql')
    expect(result.includes).toHaveLength(1)
    expect(result.includes[0].type).toBe('include')
    expect(result.includes[0].path).toBe('./extra.sql')
    // imports and tags still work
    expect(result.imports).toHaveLength(1)
    expect(result.tags).toHaveLength(1)
  })

  it('skips @external and @include in tag parsing', () => {
    const text = "-- @external './base.sql'\n-- @include './extra.sql'"
    const result = parse(text)
    // Should not appear as tags
    expect(result.tags).toHaveLength(0)
  })

  it('returns empty externals and includes when none present', () => {
    const result = parse('CREATE TABLE users (id BIGSERIAL);')
    expect(result.externals).toHaveLength(0)
    expect(result.includes).toHaveLength(0)
  })
})
