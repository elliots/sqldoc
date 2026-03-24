import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { SqlparserTsAdapter } from '../ast/sqlparser-ts'
import type { SqlStatement } from '../ast/types'
import { buildBlocks } from '../blocks'
import { parse } from '../parser'

const fixture = fs.readFileSync(path.join(__dirname, 'tags.sql'), 'utf-8')

describe('block resolution from tags.sql', () => {
  let stmts: SqlStatement[]

  beforeAll(async () => {
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

  it('@for("one") — above CREATE TABLE → table', () => {
    const { ast } = blockFor('"one"')
    expect(ast.target).toBe('table')
    expect(ast.objectName).toBe('one')
  })

  it('@for("one again") — same line as CREATE TABLE → table', () => {
    const { ast } = blockFor('"one again"')
    expect(ast.target).toBe('table')
    expect(ast.objectName).toBe('one')
  })

  it('@for("two") — above column two → column', () => {
    const { ast } = blockFor('"two"')
    expect(ast.target).toBe('column')
    expect(ast.columnName).toBe('two')
  })

  it('@for("two again") — same line as column two → column', () => {
    const { ast } = blockFor('"two again"')
    expect(ast.target).toBe('column')
    expect(ast.columnName).toBe('two')
  })

  it('@for("three") — same line as column three → column', () => {
    const { ast } = blockFor('"three"')
    expect(ast.target).toBe('column')
    expect(ast.columnName).toBe('three')
  })

  it('@for("four") — above column four with blank lines → column', () => {
    const { ast } = blockFor('"four"')
    expect(ast.target).toBe('column')
    expect(ast.columnName).toBe('four')
  })

  it('@for("one yet again") — after all columns → table', () => {
    const { ast } = blockFor('"one yet again"')
    expect(ast.target).toBe('table')
    expect(ast.objectName).toBe('one')
  })
})
