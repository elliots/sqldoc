import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, mockMethod } from '@sqldoc/test-utils'

describe('initCommand', () => {
  const tempDirs: string[] = []
  let exitSpy: ReturnType<typeof mockMethod>
  let consoleLogSpy: ReturnType<typeof mockMethod>
  let consoleErrorSpy: ReturnType<typeof mockMethod>

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'sqldoc-init-test-'))
    tempDirs.push(dir)
    return dir
  }

  /** Create a minimal fake repo so devPath mode has something to link */
  function makeFakeRepo(): string {
    const repo = makeTempDir()
    const pkgDir = join(repo, 'packages', 'cli')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@sqldoc/cli' }))
    return repo
  }

  beforeEach(() => {
    exitSpy = mockMethod(process, 'exit', ((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as any)
    consoleLogSpy = mockMethod(console, 'log', () => {})
    consoleErrorSpy = mockMethod(console, 'error', () => {})
  })

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
    exitSpy.restore()
    consoleLogSpy.restore()
    consoleErrorSpy.restore()
  })

  it('creates .sqldoc/ directory', async () => {
    const root = makeTempDir()
    const repo = makeFakeRepo()
    const { initCommand } = await import('../commands/init.ts')
    await initCommand(root, repo)

    expect(existsSync(join(root, '.sqldoc'))).toBe(true)
  })

  it('creates .sqldoc/package.json with correct structure', async () => {
    const root = makeTempDir()
    const repo = makeFakeRepo()
    const { initCommand } = await import('../commands/init.ts')
    await initCommand(root, repo)

    const pkgPath = join(root, '.sqldoc', 'package.json')
    expect(existsSync(pkgPath)).toBe(true)

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    expect(pkg.name).toBe('sqldoc-local')
    expect(pkg.private).toBe(true)
  })

  it('creates .sqldoc/.gitignore containing node_modules/', async () => {
    const root = makeTempDir()
    const repo = makeFakeRepo()
    const { initCommand } = await import('../commands/init.ts')
    await initCommand(root, repo)

    const gitignorePath = join(root, '.sqldoc', '.gitignore')
    expect(existsSync(gitignorePath)).toBe(true)

    const content = readFileSync(gitignorePath, 'utf-8')
    expect(content).toContain('node_modules/')
  })

  it('errors when .sqldoc/ already exists', async () => {
    const root = makeTempDir()
    mkdirSync(join(root, '.sqldoc'))

    const { initCommand } = await import('../commands/init.ts')
    await expect(initCommand(root)).rejects.toThrow('process.exit(1)')

    expect(exitSpy.callCount() > 0).toBeTruthy()
    expect(exitSpy.calls.some((c: any[]) => c[0] === 1)).toBeTruthy()
    const errorOutput = consoleErrorSpy.calls.map((c: any[]) => String(c[0])).join(' ')
    expect(errorOutput).toContain('already exists')
  })

  it('creates sqldoc.config.ts when none exists', async () => {
    const root = makeTempDir()
    const repo = makeFakeRepo()
    const { initCommand } = await import('../commands/init.ts')
    await initCommand(root, repo)

    const configPath = join(root, 'sqldoc.config.ts')
    expect(existsSync(configPath)).toBe(true)

    const content = readFileSync(configPath, 'utf-8')
    expect(content).toContain('export default')
  })

  it('does not overwrite existing sqldoc.config.ts', async () => {
    const root = makeTempDir()
    const repo = makeFakeRepo()
    const configPath = join(root, 'sqldoc.config.ts')
    const originalContent = 'export default { custom: true }\n'
    writeFileSync(configPath, originalContent)

    const { initCommand } = await import('../commands/init.ts')
    await initCommand(root, repo)

    const content = readFileSync(configPath, 'utf-8')
    expect(content).toBe(originalContent)
  })
})
