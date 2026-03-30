import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from '@sqldoc/test-utils'
import { findSqldocDir } from '../find-sqldoc.ts'

describe('findSqldocDir', () => {
  const tempDirs: string[] = []

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'sqldoc-test-'))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it('returns absolute path when .sqldoc/ exists in startDir', () => {
    const root = makeTempDir()
    const sqldocDir = join(root, '.sqldoc')
    mkdirSync(sqldocDir)

    const result = findSqldocDir(root)
    expect(result).toBe(sqldocDir)
  })

  it('returns absolute path when .sqldoc/ exists in a parent directory', () => {
    const root = makeTempDir()
    const sqldocDir = join(root, '.sqldoc')
    mkdirSync(sqldocDir)

    const nested = join(root, 'a', 'b', 'c')
    mkdirSync(nested, { recursive: true })

    const result = findSqldocDir(nested)
    expect(result).toBe(sqldocDir)
  })

  it('returns null when .sqldoc/ does not exist up to filesystem root', () => {
    const root = makeTempDir()
    const nested = join(root, 'no-sqldoc', 'deep')
    mkdirSync(nested, { recursive: true })

    // Start from a deep dir with no .sqldoc anywhere above
    // Use the temp dir itself (no .sqldoc) -- will walk up to / and find nothing
    const result = findSqldocDir(nested)
    expect(result).toBe(null)
  })

  it('uses process.cwd() as default startDir', () => {
    // Just verify it doesn't throw when called without args
    const result = findSqldocDir()
    expect(result === null || typeof result === 'string').toBe(true)
  })
})
