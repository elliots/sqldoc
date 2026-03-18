import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectPM } from '../detect-pm.ts'

describe('detectPM', () => {
  const tempDirs: string[] = []

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'sqldoc-pm-test-'))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it("returns 'pnpm' when pnpm-lock.yaml exists", () => {
    const root = makeTempDir()
    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    expect(detectPM(root)).toBe('pnpm')
  })

  it("returns 'yarn' when yarn.lock exists", () => {
    const root = makeTempDir()
    writeFileSync(join(root, 'yarn.lock'), '')
    expect(detectPM(root)).toBe('yarn')
  })

  it("returns 'bun' when bun.lockb exists", () => {
    const root = makeTempDir()
    writeFileSync(join(root, 'bun.lockb'), '')
    expect(detectPM(root)).toBe('bun')
  })

  it("returns 'bun' when bun.lock exists", () => {
    const root = makeTempDir()
    writeFileSync(join(root, 'bun.lock'), '')
    expect(detectPM(root)).toBe('bun')
  })

  it("returns 'npm' when package-lock.json exists", () => {
    const root = makeTempDir()
    writeFileSync(join(root, 'package-lock.json'), '')
    expect(detectPM(root)).toBe('npm')
  })

  it("returns 'npm' as fallback when no lockfile found", () => {
    const root = makeTempDir()
    expect(detectPM(root)).toBe('npm')
  })

  it('checks in priority order: pnpm > yarn > bun > npm', () => {
    const root = makeTempDir()
    // When all lockfiles exist, pnpm should win
    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    writeFileSync(join(root, 'yarn.lock'), '')
    writeFileSync(join(root, 'bun.lockb'), '')
    writeFileSync(join(root, 'package-lock.json'), '')
    expect(detectPM(root)).toBe('pnpm')
  })
})
