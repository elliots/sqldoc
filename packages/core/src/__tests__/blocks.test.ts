import * as fs from 'node:fs'
import * as path from 'node:path'
import { before, describe, expect, it } from '@sqldoc/test-utils'
import { SqlparserTsAdapter } from '../ast/sqlparser-ts.ts'
import type { SqlStatement } from '../ast/types.ts'
import { buildBlocks } from '../blocks.ts'
import { parse } from '../parser.ts'

const fixture = fs.readFileSync(path.join(import.meta.dirname, 'tags.sql'), 'utf-8')

describe('block resolution from tags.sql', () => {
  let stmts: SqlStatement[]

  before(async () => {
    const adapter = new SqlparserTsAdapter('postgres')
    await adapter.init()
    stmts = adapter.parseStatements(fixture)
  })

  function getBlocks() {
    const { tags } = parse(fixture)
    const docLines = fixture.split('\n')
    return buildBlocks(tags, fixture, docLines, stmts)
  }

  /** Find the block containing a tag with the given rawArgs value */
  function blockFor(argValue: string) {
    const blocks = getBlocks()
    for (const block of blocks) {
      for (const tag of block.tags) {
        if (tag.rawArgs?.includes(argValue)) {
          return { block, tag, ast: block.ast }
        }
      }
    }
    throw new Error(`No block found for arg "${argValue}"`)
  }

  it('@for("one") -- above CREATE TABLE -> table', () => {
    const { ast } = blockFor('"one"')
    expect(ast.target).toBe('table')
    expect(ast.objectName).toBe('one')
  })

  it('@for("one again") -- same line as CREATE TABLE -> table', () => {
    const { ast } = blockFor('"one again"')
    expect(ast.target).toBe('table')
    expect(ast.objectName).toBe('one')
  })

  it('@for("two") -- above column two -> column', () => {
    const { ast } = blockFor('"two"')
    expect(ast.target).toBe('column')
    expect(ast.columnName).toBe('two')
  })

  it('@for("two again") -- same line as column two -> column', () => {
    const { ast } = blockFor('"two again"')
    expect(ast.target).toBe('column')
    expect(ast.columnName).toBe('two')
  })

  it('@for("three") -- same line as column three -> column', () => {
    const { ast } = blockFor('"three"')
    expect(ast.target).toBe('column')
    expect(ast.columnName).toBe('three')
  })

  it('@for("four") -- above column four with blank lines -> column', () => {
    const { ast } = blockFor('"four"')
    expect(ast.target).toBe('column')
    expect(ast.columnName).toBe('four')
  })

  it('@for("one yet again") -- after all columns -> table', () => {
    const { ast } = blockFor('"one yet again"')
    expect(ast.target).toBe('table')
    expect(ast.objectName).toBe('one')
  })

  it('keeps the enclosing type target when a tag appears before the closing composite type delimiter', () => {
    const source = [
      "-- @docs.description('Composite type for reporting')",
      'CREATE TYPE adoption_report AS (',
      '  pet_name TEXT,',
      '  owner_name TEXT',
      "-- @docs.description('Type-level docs before closing')",
      ');',
    ].join('\n')

    const { tags } = parse(source)
    const blocks = buildBlocks(tags, source, source.split('\n'), [
      {
        kind: 'type',
        name: 'adoption_report',
        line: 2,
        columns: [
          { name: 'pet_name', type: 'text', line: 3 },
          { name: 'owner_name', type: 'text', line: 4 },
        ],
        node: null,
      },
    ])

    expect(blocks).toHaveLength(2)
    expect(blocks[1].ast.target).toBe('type')
    expect(blocks[1].ast.objectName).toBe('adoption_report')
  })

  it('binds a tag between composite types to the next type, not the previous one', () => {
    const source = [
      "-- @docs.description('Composite type for reporting')",
      'CREATE TYPE adoption_report AS (',
      '  pet_name TEXT,',
      '  owner_name TEXT',
      ');',
      "-- @docs.description('Docs for the next type')",
      'CREATE TYPE another AS (',
      '  pet_name TEXT,',
      '  owner_name TEXT',
      ');',
    ].join('\n')

    const { tags } = parse(source)
    const blocks = buildBlocks(tags, source, source.split('\n'), [
      {
        kind: 'type',
        name: 'adoption_report',
        line: 2,
        columns: [
          { name: 'pet_name', type: 'text', line: 3 },
          { name: 'owner_name', type: 'text', line: 4 },
        ],
        node: null,
      },
      {
        kind: 'type',
        name: 'another',
        line: 7,
        columns: [
          { name: 'pet_name', type: 'text', line: 8 },
          { name: 'owner_name', type: 'text', line: 9 },
        ],
        node: null,
      },
    ])

    expect(blocks).toHaveLength(2)
    expect(blocks[1].ast.target).toBe('type')
    expect(blocks[1].ast.objectName).toBe('another')
  })

  it('does not bind backward after a completed type definition', () => {
    const source = [
      "-- @docs.description('Composite type for reporting')",
      'CREATE TYPE adoption_report AS (',
      '  pet_name TEXT,',
      '  owner_name TEXT',
      ');',
      "-- @docs.description('Detached comment after the type')",
    ].join('\n')

    const { tags } = parse(source)
    const blocks = buildBlocks(tags, source, source.split('\n'), [
      {
        kind: 'type',
        name: 'adoption_report',
        line: 2,
        columns: [
          { name: 'pet_name', type: 'text', line: 3 },
          { name: 'owner_name', type: 'text', line: 4 },
        ],
        node: null,
      },
    ])

    expect(blocks).toHaveLength(2)
    expect(blocks[1].ast.target).toBe('unknown')
    expect(blocks[1].ast.objectName).toBe(undefined)
  })
})
