/**
 * Tests for SQL file resolver with glob expansion, transitive resolution,
 * cycle detection, dedup, and missing file errors.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it, useTmpDir } from '@sqldoc/test-utils'
import { resolveDirectives } from '../resolver.ts'

const tmpDir = useTmpDir('sqldoc-resolver-')

/** Helper to write a SQL file and return its real absolute path (symlinks resolved) */
function writeFile(dir: string, relPath: string, content: string): string {
  const abs = path.join(dir, relPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
  return fs.realpathSync(abs)
}

/** Helper readFile function for the resolver */
function readFile(p: string): string {
  return fs.readFileSync(p, 'utf8')
}

describe('resolveDirectives', () => {
  it('resolves a single @external file', async () => {
    const dir = tmpDir()
    const base = writeFile(dir, 'base.sql', 'CREATE TABLE base (id INT);')
    const main = writeFile(dir, 'main.sql', "-- @external './base.sql'\nCREATE TABLE users (id INT);")

    const result = await resolveDirectives([main], readFile)
    expect(result.externalFiles).toHaveLength(1)
    expect(result.externalFiles[0]).toBe(base)
    expect(result.includeFiles).toHaveLength(0)
  })

  it('resolves a single @include file', async () => {
    const dir = tmpDir()
    const extra = writeFile(dir, 'extra.sql', 'CREATE TABLE extra (id INT);')
    const main = writeFile(dir, 'main.sql', "-- @include './extra.sql'\nCREATE TABLE users (id INT);")

    const result = await resolveDirectives([main], readFile)
    expect(result.includeFiles).toHaveLength(1)
    expect(result.includeFiles[0]).toBe(extra)
    expect(result.externalFiles).toHaveLength(0)
  })

  it('expands globs for @external', async () => {
    const dir = tmpDir()
    writeFile(dir, 'schemas/a.sql', 'CREATE TABLE a (id INT);')
    writeFile(dir, 'schemas/b.sql', 'CREATE TABLE b (id INT);')
    const main = writeFile(dir, 'main.sql', "-- @external './schemas/*.sql'\nCREATE TABLE users (id INT);")

    const result = await resolveDirectives([main], readFile)
    expect(result.externalFiles).toHaveLength(2)
    // Should be sorted for determinism
    const names = result.externalFiles.map((f) => path.basename(f)).sort()
    expect(names).toEqual(['a.sql', 'b.sql'])
  })

  it('resolves transitive references', async () => {
    const dir = tmpDir()
    const c = writeFile(dir, 'c.sql', 'CREATE TABLE c (id INT);')
    const b = writeFile(dir, 'b.sql', "-- @external './c.sql'\nCREATE TABLE b (id INT);")
    const a = writeFile(dir, 'a.sql', "-- @external './b.sql'\nCREATE TABLE a (id INT);")

    const result = await resolveDirectives([a], readFile)
    // b and c should both be external (transitive)
    expect(result.externalFiles).toContain(b)
    expect(result.externalFiles).toContain(c)
  })

  it('detects cycles without infinite loop', async () => {
    const dir = tmpDir()
    // A references B, B references A — A is a project file, B is external
    const a = writeFile(dir, 'a.sql', "-- @external './b.sql'\nCREATE TABLE a (id INT);")
    const b = writeFile(dir, 'b.sql', "-- @external './a.sql'\nCREATE TABLE b (id INT);")

    const result = await resolveDirectives([a], readFile)
    // b.sql should be external; a.sql remains project (it was passed as project file)
    expect(result.externalFiles).toContain(b)
    expect(result.provenanceMap.get(a)).toBe('project')
    expect(result.provenanceMap.get(b)).toBe('external')
    // No infinite loop occurred — test completes
  })

  it('deduplicates when multiple files reference the same file', async () => {
    const dir = tmpDir()
    const shared = writeFile(dir, 'shared.sql', 'CREATE TABLE shared (id INT);')
    const a = writeFile(dir, 'a.sql', "-- @external './shared.sql'\nCREATE TABLE a (id INT);")
    const b = writeFile(dir, 'b.sql', "-- @external './shared.sql'\nCREATE TABLE b (id INT);")

    const result = await resolveDirectives([a, b], readFile)
    // shared.sql should appear only once
    const count = result.externalFiles.filter((f) => f === shared).length
    expect(count).toBe(1)
  })

  it('throws error for missing referenced file', async () => {
    const dir = tmpDir()
    const main = writeFile(dir, 'main.sql', "-- @external './nonexistent.sql'\nCREATE TABLE users (id INT);")

    try {
      await resolveDirectives([main], readFile)
      expect(true).toBe(false) // Should not reach here
    } catch (err: any) {
      expect(err.message).toContain('nonexistent.sql')
      expect(err.message).toContain('main.sql')
    }
  })

  it('resolves mixed @external and @include correctly', async () => {
    const dir = tmpDir()
    const base = writeFile(dir, 'base.sql', 'CREATE TABLE base (id INT);')
    const extra = writeFile(dir, 'extra.sql', 'CREATE TABLE extra (id INT);')
    const main = writeFile(
      dir,
      'main.sql',
      "-- @external './base.sql'\n-- @include './extra.sql'\nCREATE TABLE users (id INT);",
    )

    const result = await resolveDirectives([main], readFile)
    expect(result.externalFiles).toHaveLength(1)
    expect(result.externalFiles[0]).toBe(base)
    expect(result.includeFiles).toHaveLength(1)
    expect(result.includeFiles[0]).toBe(extra)
  })

  it('resolves @external inside an @include file', async () => {
    const dir = tmpDir()
    const base = writeFile(dir, 'base.sql', 'CREATE TABLE base (id INT);')
    const inc = writeFile(dir, 'inc.sql', "-- @external './base.sql'\nCREATE TABLE inc (id INT);")
    const main = writeFile(dir, 'main.sql', "-- @include './inc.sql'\nCREATE TABLE users (id INT);")

    const result = await resolveDirectives([main], readFile)
    expect(result.includeFiles).toContain(inc)
    expect(result.externalFiles).toContain(base)
  })

  it('builds provenanceMap correctly', async () => {
    const dir = tmpDir()
    const base = writeFile(dir, 'base.sql', 'CREATE TABLE base (id INT);')
    const extra = writeFile(dir, 'extra.sql', 'CREATE TABLE extra (id INT);')
    const main = writeFile(
      dir,
      'main.sql',
      "-- @external './base.sql'\n-- @include './extra.sql'\nCREATE TABLE users (id INT);",
    )

    const result = await resolveDirectives([main], readFile)
    expect(result.provenanceMap.get(main)).toBe('project')
    expect(result.provenanceMap.get(base)).toBe('external')
    expect(result.provenanceMap.get(extra)).toBe('include')
  })

  it('external takes precedence when a file is both external and include', async () => {
    const dir = tmpDir()
    const shared = writeFile(dir, 'shared.sql', 'CREATE TABLE shared (id INT);')
    const a = writeFile(dir, 'a.sql', "-- @external './shared.sql'\nCREATE TABLE a (id INT);")
    const b = writeFile(dir, 'b.sql', "-- @include './shared.sql'\nCREATE TABLE b (id INT);")

    const result = await resolveDirectives([a, b], readFile)
    // external takes precedence
    expect(result.provenanceMap.get(shared)).toBe('external')
    expect(result.externalFiles).toContain(shared)
    // Should not be in includeFiles
    expect(result.includeFiles).not.toContain(shared)
  })

  it('handles project files with no directives', async () => {
    const dir = tmpDir()
    const main = writeFile(dir, 'main.sql', 'CREATE TABLE users (id INT);')

    const result = await resolveDirectives([main], readFile)
    expect(result.externalFiles).toHaveLength(0)
    expect(result.includeFiles).toHaveLength(0)
    expect(result.provenanceMap.get(main)).toBe('project')
  })
})
