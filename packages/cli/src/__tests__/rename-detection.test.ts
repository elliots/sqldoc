import { describe, it } from 'node:test'
import type { CompilerOutput } from '@sqldoc/core'
import { expect } from '@sqldoc/test-utils'
import { buildRenamesFromPreviously } from '../commands/migrate.ts'

function makeOutput(
  fileTags: CompilerOutput['fileTags'] = [],
  overrides: Partial<CompilerOutput> = {},
): CompilerOutput {
  return {
    sourceFile: 'schema.sql',
    mergedSql: '',
    sqlOutputs: [],
    codeOutputs: [],
    errors: [],
    docsMeta: [],
    fileTags,
    ...overrides,
  }
}

describe('buildRenamesFromPreviously', () => {
  it('extracts column renames from @docs.previously tags', () => {
    const outputs = [
      makeOutput([
        {
          objectName: 'users.email',
          target: 'column',
          tags: [{ namespace: 'docs', tag: 'previously', args: ['email_address'] }],
        },
      ]),
    ]

    const renames = buildRenamesFromPreviously(outputs)

    expect(renames).toHaveLength(1)
    expect(renames[0]).toEqual({
      type: 'column',
      table: 'users',
      oldName: 'email_address',
      newName: 'email',
    })
  })

  it('extracts table renames from @docs.previously tags', () => {
    const outputs = [
      makeOutput([
        {
          objectName: 'accounts',
          target: 'table',
          tags: [{ namespace: 'docs', tag: 'previously', args: ['users'] }],
        },
      ]),
    ]

    const renames = buildRenamesFromPreviously(outputs)

    expect(renames).toHaveLength(1)
    expect(renames[0]).toEqual({
      type: 'table',
      table: 'accounts',
      oldName: 'users',
      newName: 'accounts',
    })
  })

  it('returns empty array when no @docs.previously tags', () => {
    const outputs = [
      makeOutput([
        {
          objectName: 'users',
          target: 'table',
          tags: [{ namespace: 'audit', tag: 'track', args: { on: ['delete'] } }],
        },
      ]),
    ]

    const renames = buildRenamesFromPreviously(outputs)

    expect(renames).toHaveLength(0)
  })

  it('handles multiple renames across files', () => {
    const outputs = [
      makeOutput([
        {
          objectName: 'users.email',
          target: 'column',
          tags: [{ namespace: 'docs', tag: 'previously', args: ['email_address'] }],
        },
      ]),
      makeOutput([
        {
          objectName: 'posts.title',
          target: 'column',
          tags: [{ namespace: 'docs', tag: 'previously', args: ['subject'] }],
        },
      ]),
    ]

    const renames = buildRenamesFromPreviously(outputs)

    expect(renames).toHaveLength(2)
    expect(renames[0].table).toBe('users')
    expect(renames[0].oldName).toBe('email_address')
    expect(renames[0].newName).toBe('email')
    expect(renames[1].table).toBe('posts')
    expect(renames[1].oldName).toBe('subject')
    expect(renames[1].newName).toBe('title')
  })

  it('ignores tags with non-string args', () => {
    const outputs = [
      makeOutput([
        {
          objectName: 'users.email',
          target: 'column',
          tags: [{ namespace: 'docs', tag: 'previously', args: [] }],
        },
      ]),
    ]

    const renames = buildRenamesFromPreviously(outputs)

    expect(renames).toHaveLength(0)
  })

  it('ignores @docs tags that are not "previously"', () => {
    const outputs = [
      makeOutput([
        {
          objectName: 'users.email',
          target: 'column',
          tags: [{ namespace: 'docs', tag: 'description', args: ['User email'] }],
        },
      ]),
    ]

    const renames = buildRenamesFromPreviously(outputs)

    expect(renames).toHaveLength(0)
  })
})
