import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { CompilerOutput, NamespacePlugin, ProjectContext, ProjectOutput } from '@sqldoc/core'
import { compile, loadImports, parse, SqlparserTsAdapter } from '@sqldoc/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Replicate the CLI codegen loop for project-level hooks.
 * This mirrors packages/cli/src/commands/codegen.ts Task 1 logic.
 */
async function compileFiles(
  files: Array<{ filePath: string; source: string }>,
  adapter: SqlparserTsAdapter,
  config: Record<string, unknown> = {},
): Promise<{ allOutputs: CompilerOutput[]; allPlugins: Map<string, NamespacePlugin>; mergedSql: string }> {
  const allOutputs: CompilerOutput[] = []
  const allPlugins = new Map<string, NamespacePlugin>()
  const mergedOutputs: string[] = []

  for (const { filePath, source } of files) {
    const { imports } = parse(source)

    const { namespaces } = await loadImports(
      imports.map((i) => i.path),
      filePath,
    )
    const plugins = new Map<string, NamespacePlugin>([...namespaces].map(([k, v]) => [k, v as NamespacePlugin]))
    let statements: import('@sqldoc/core').SqlStatement[] = []
    try {
      statements = adapter.parseStatements(source)
    } catch {
      // non-fatal
    }
    const output = compile({ source, filePath, plugins, statements, adapter, config })
    mergedOutputs.push(output.mergedSql)
    allOutputs.push(output)
    for (const [name, plugin] of plugins) {
      if (!allPlugins.has(name)) allPlugins.set(name, plugin)
    }
  }

  return { allOutputs, allPlugins, mergedSql: mergedOutputs.join('\n') }
}

/**
 * Build ProjectContext and invoke project hooks, mirroring the CLI flow.
 */
async function invokeProjectHooks(
  allOutputs: CompilerOutput[],
  allPlugins: Map<string, NamespacePlugin>,
  mergedSql: string,
  configRoot: string,
  config: Record<string, unknown> = {},
  pluginFilter: Set<string> | null = null,
): Promise<{
  results: Array<{ nsName: string; result: ProjectOutput }>
  filesWritten: string[]
}> {
  const projectPlugins = [...allPlugins.entries()].filter(
    ([name, p]) => typeof p.afterCompile === 'function' && (pluginFilter === null || pluginFilter.has(name)),
  )

  const allFileTags = allOutputs.map((o) => ({
    sourceFile: o.sourceFile,
    objects: o.fileTags.map((ft) => ({
      objectName: ft.objectName,
      target: ft.target,
      tags: ft.tags,
    })),
  }))

  const results: Array<{ nsName: string; result: ProjectOutput }> = []
  const filesWritten: string[] = []

  for (const [nsName, plugin] of projectPlugins) {
    const docsMeta = allOutputs.flatMap((o) => o.docsMeta ?? [])
    const ctx: ProjectContext = {
      outputs: allOutputs,
      mergedSql,
      allFileTags,
      docsMeta,
      config: (config as any)?.namespaces?.[nsName] ?? {},
      projectRoot: configRoot,
    }

    const result = await plugin.afterCompile!(ctx)
    results.push({ nsName, result })

    if (result?.files) {
      for (const file of result.files) {
        const outPath = path.resolve(configRoot, file.filePath)
        fs.mkdirSync(path.dirname(outPath), { recursive: true })
        fs.writeFileSync(outPath, file.content, 'utf-8')
        filesWritten.push(outPath)
      }
    }
  }

  return { results, filesWritten }
}

const fixturesDir = path.join(__dirname, 'fixtures')

describe('E2E: project-level hooks via CLI compile flow', () => {
  let adapter: SqlparserTsAdapter
  let tmpDir: string

  beforeAll(async () => {
    adapter = new SqlparserTsAdapter('postgres')
    await adapter.init()
  })

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-project-hooks-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('invokes afterCompile with correct ProjectContext and writes output files', async () => {
    // Use the existing anon-test fixture which has tags
    const source = fs.readFileSync(path.join(fixturesDir, 'anon-test.sql'), 'utf-8')
    const filePath = path.join(fixturesDir, 'anon-test.sql')

    const { allOutputs, mergedSql } = await compileFiles([{ filePath, source }], adapter)

    // Create a mock plugin with afterCompile
    let receivedCtx: ProjectContext | null = null
    const mockPlugin: NamespacePlugin = {
      name: 'mock-docs',
      apiVersion: 1,
      tags: {},
      afterCompile(ctx: ProjectContext): ProjectOutput {
        receivedCtx = ctx
        return {
          files: [{ filePath: 'docs/schema.md', content: '# Schema Documentation\n\nGenerated.' }],
        }
      },
    }

    const mockPlugins = new Map<string, NamespacePlugin>([['mock-docs', mockPlugin]])

    const { filesWritten } = await invokeProjectHooks(allOutputs, mockPlugins, mergedSql, tmpDir)

    // Verify ctx was passed with correct structure
    expect(receivedCtx).not.toBeNull()
    expect(receivedCtx!.outputs).toHaveLength(1)
    expect(receivedCtx!.mergedSql).toContain('CREATE TABLE customers')
    expect(receivedCtx!.allFileTags).toHaveLength(1)
    expect(receivedCtx!.allFileTags[0].sourceFile).toBe(filePath)
    expect(receivedCtx!.allFileTags[0].objects.length).toBeGreaterThan(0)
    expect(receivedCtx!.projectRoot).toBe(tmpDir)

    // Verify file was written
    expect(filesWritten).toHaveLength(1)
    const writtenPath = path.resolve(tmpDir, 'docs/schema.md')
    expect(fs.existsSync(writtenPath)).toBe(true)
    expect(fs.readFileSync(writtenPath, 'utf-8')).toContain('# Schema Documentation')
  })

  it('populates fileTags on CompilerOutput with correct structure', async () => {
    const source = fs.readFileSync(path.join(fixturesDir, 'anon-test.sql'), 'utf-8')
    const filePath = path.join(fixturesDir, 'anon-test.sql')

    const { allOutputs } = await compileFiles([{ filePath, source }], adapter)

    expect(allOutputs).toHaveLength(1)
    const output = allOutputs[0]

    // fileTags should be populated for the anon-test fixture
    expect(output.fileTags.length).toBeGreaterThan(0)

    // The fixture has anon tags on columns of the 'customers' table
    // fileTags use table.column format for column-level tags
    const anonEntries = output.fileTags.filter((ft) => ft.tags.some((t) => t.namespace === 'anon'))
    expect(anonEntries.length).toBeGreaterThan(0)

    // Each entry should have correct structure
    for (const entry of anonEntries) {
      expect(entry.objectName).toMatch(/^customers\./)
      expect(entry.target).toBe('column')
      expect(entry.tags.length).toBeGreaterThan(0)
      expect(entry.tags[0].namespace).toBe('anon')
    }
  })

  it('respects --plugins filter: only invokes named plugins', async () => {
    const source = fs.readFileSync(path.join(fixturesDir, 'anon-test.sql'), 'utf-8')
    const filePath = path.join(fixturesDir, 'anon-test.sql')

    const { allOutputs, mergedSql } = await compileFiles([{ filePath, source }], adapter)

    let pluginACalled = false
    let pluginBCalled = false

    const pluginA: NamespacePlugin = {
      name: 'plugin-a',
      apiVersion: 1,
      tags: {},
      afterCompile(_ctx: ProjectContext): ProjectOutput {
        pluginACalled = true
        return { files: [] }
      },
    }

    const pluginB: NamespacePlugin = {
      name: 'plugin-b',
      apiVersion: 1,
      tags: {},
      afterCompile(_ctx: ProjectContext): ProjectOutput {
        pluginBCalled = true
        return { files: [] }
      },
    }

    const mockPlugins = new Map<string, NamespacePlugin>([
      ['plugin-a', pluginA],
      ['plugin-b', pluginB],
    ])

    // Filter to only plugin-a
    const pluginFilter = new Set(['plugin-a'])
    await invokeProjectHooks(allOutputs, mockPlugins, mergedSql, tmpDir, {}, pluginFilter)

    expect(pluginACalled).toBe(true)
    expect(pluginBCalled).toBe(false)
  })

  it('completes without errors when no plugin has afterCompile', async () => {
    const source = fs.readFileSync(path.join(fixturesDir, 'anon-test.sql'), 'utf-8')
    const filePath = path.join(fixturesDir, 'anon-test.sql')

    const { allOutputs, mergedSql } = await compileFiles([{ filePath, source }], adapter)

    // Plugin without afterCompile
    const pluginNoProject: NamespacePlugin = {
      name: 'no-project',
      apiVersion: 1,
      tags: {},
    }

    const mockPlugins = new Map<string, NamespacePlugin>([['no-project', pluginNoProject]])

    const { results, filesWritten } = await invokeProjectHooks(allOutputs, mockPlugins, mergedSql, tmpDir)

    // No project plugins matched, so no results
    expect(results).toHaveLength(0)
    expect(filesWritten).toHaveLength(0)
  })
})
