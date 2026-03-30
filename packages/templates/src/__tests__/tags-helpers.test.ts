import { describe, expect, it } from '@sqldoc/test-utils'
import { findRename, findTypeOverride, isSkipped } from '../helpers/tags.ts'

describe('findRename', () => {
  it('returns undefined when no rename tag exists', () => {
    const tags = [{ namespace: 'codegen', tag: 'skip', args: [] }]
    expect(findRename(tags, 'typescript')).toBe(undefined)
  })

  it('returns global rename when no template-specific exists', () => {
    const tags = [{ namespace: 'codegen', tag: 'rename', args: ['UserAccount'] }]
    expect(findRename(tags, 'typescript')).toBe('UserAccount')
  })

  it('returns template-specific rename over global', () => {
    const tags = [
      { namespace: 'codegen', tag: 'rename', args: ['UserAccount'] },
      { namespace: 'codegen', tag: 'rename', args: ['UserModel', 'typescript'] },
    ]
    expect(findRename(tags, 'typescript')).toBe('UserModel')
  })

  it('returns global rename for different template', () => {
    const tags = [
      { namespace: 'codegen', tag: 'rename', args: ['UserAccount'] },
      { namespace: 'codegen', tag: 'rename', args: ['UserModel', 'typescript'] },
    ]
    expect(findRename(tags, 'go-structs')).toBe('UserAccount')
  })
})

describe('isSkipped', () => {
  it('returns false when no skip tag exists', () => {
    const tags = [{ namespace: 'codegen', tag: 'rename', args: ['Foo'] }]
    expect(isSkipped(tags, 'typescript')).toBe(false)
  })

  it('returns true for global skip (no args)', () => {
    const tags = [{ namespace: 'codegen', tag: 'skip', args: [] }]
    expect(isSkipped(tags, 'typescript')).toBe(true)
  })

  it('returns true for template-specific skip', () => {
    const tags = [{ namespace: 'codegen', tag: 'skip', args: ['typescript'] }]
    expect(isSkipped(tags, 'typescript')).toBe(true)
  })

  it('returns false for skip targeting different template', () => {
    const tags = [{ namespace: 'codegen', tag: 'skip', args: ['go-structs'] }]
    expect(isSkipped(tags, 'typescript')).toBe(false)
  })
})

describe('findTypeOverride', () => {
  it('returns undefined when no type tag exists', () => {
    const tags = [{ namespace: 'codegen', tag: 'rename', args: ['Foo'] }]
    expect(findTypeOverride(tags, 'typescript')).toBe(undefined)
  })

  it('returns global type override', () => {
    const tags = [{ namespace: 'codegen', tag: 'type', args: ['CustomType'] }]
    expect(findTypeOverride(tags, 'typescript')).toBe('CustomType')
  })

  it('returns template-specific type over global', () => {
    const tags = [
      { namespace: 'codegen', tag: 'type', args: ['GlobalType'] },
      { namespace: 'codegen', tag: 'type', args: ['TsType', 'typescript'] },
    ]
    expect(findTypeOverride(tags, 'typescript')).toBe('TsType')
  })
})
