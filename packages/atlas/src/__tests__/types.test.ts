import { describe, expect, it } from 'vitest'
import { type AtlasAttr, type AtlasCheck, type AtlasComment, type AtlasTag, findTags, isTag } from '../types'

describe('isTag', () => {
  it('returns true for a valid Tag attr', () => {
    const tag: AtlasTag = { Name: 'pii.mask', Args: '' }
    expect(isTag(tag)).toBe(true)
  })

  it('returns true for a Tag with non-empty Args', () => {
    const tag: AtlasTag = { Name: 'audit.track', Args: 'on: [delete, update]' }
    expect(isTag(tag)).toBe(true)
  })

  it('returns false for a Comment attr', () => {
    const comment: AtlasComment = { Text: 'User account table' }
    expect(isTag(comment)).toBe(false)
  })

  it('returns false for a Check attr (has Name AND Expr)', () => {
    const check: AtlasCheck = { Name: 'email_check', Expr: "email LIKE '%@%'" }
    expect(isTag(check)).toBe(false)
  })

  it('returns false for an unknown Record attr', () => {
    const unknown: Record<string, unknown> = { Filename: 'schema.sql', Start: { Line: 1 } }
    expect(isTag(unknown)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isTag(null as unknown as AtlasAttr)).toBe(false)
  })

  it('returns false for a non-object', () => {
    expect(isTag('string' as unknown as AtlasAttr)).toBe(false)
  })
})

describe('findTags', () => {
  it('returns empty array for undefined attrs', () => {
    expect(findTags(undefined)).toEqual([])
  })

  it('returns empty array for empty attrs', () => {
    expect(findTags([])).toEqual([])
  })

  it('extracts only Tags from a mixed Attr array', () => {
    const attrs: AtlasAttr[] = [
      { Name: 'pii.mask', Args: '' },
      { Text: 'User email address' },
      { Name: 'gql.filter', Args: '' },
      { Name: 'email_check', Expr: "email LIKE '%@%'" },
      { Filename: 'schema.sql', Start: { Line: 5 } },
      { Name: 'gql.order', Args: 'asc' },
    ]

    const tags = findTags(attrs)
    expect(tags).toHaveLength(3)
    expect(tags[0]).toEqual({ Name: 'pii.mask', Args: '' })
    expect(tags[1]).toEqual({ Name: 'gql.filter', Args: '' })
    expect(tags[2]).toEqual({ Name: 'gql.order', Args: 'asc' })
  })

  it('returns all items when all are Tags', () => {
    const attrs: AtlasAttr[] = [
      { Name: 'ns.a', Args: 'x' },
      { Name: 'ns.b', Args: '' },
    ]
    expect(findTags(attrs)).toHaveLength(2)
  })

  it('returns empty array when no Tags present', () => {
    const attrs: AtlasAttr[] = [{ Text: 'A comment' }, { Name: 'chk', Expr: 'id > 0' }]
    expect(findTags(attrs)).toHaveLength(0)
  })
})
