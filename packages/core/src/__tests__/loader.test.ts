import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from '@sqldoc/test-utils'
import { clearLocalPluginCache, loadImports, loadLocalPlugins } from '../loader.ts'
import type { TagNamespace } from '../types.ts'

function stubPlugin(name: string): TagNamespace {
  return { name, tags: { $self: { description: name, targets: ['table'] } } }
}

function makeLoader(files: Record<string, TagNamespace>) {
  return async (specifier: string) => {
    const plugin = files[specifier]
    if (!plugin) throw new Error(`Stub loader: no plugin for ${specifier}`)
    return { default: plugin }
  }
}

function mkdtemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-loader-test-'))
}

describe('loadLocalPlugins()', () => {
  let workdir: string
  let sqldocDir: string

  beforeEach(() => {
    clearLocalPluginCache()
    workdir = mkdtemp()
    sqldocDir = path.join(workdir, '.sqldoc')
    fs.mkdirSync(path.join(sqldocDir, 'plugins'), { recursive: true })
  })

  afterEach(() => {
    clearLocalPluginCache()
    fs.rmSync(workdir, { recursive: true, force: true })
  })

  it('returns empty when plugins dir is missing', async () => {
    fs.rmSync(path.join(sqldocDir, 'plugins'), { recursive: true })
    const result = await loadLocalPlugins(sqldocDir)
    expect(result.namespaces.size).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('loads every supported extension, skips dotfiles, sorts deterministically', async () => {
    const files = ['a.ts', 'b.mts', 'c.js', '.hidden.ts', 'readme.md']
    const plugins = {
      'a.ts': stubPlugin('a'),
      'b.mts': stubPlugin('b'),
      'c.js': stubPlugin('c'),
    }
    for (const f of files) {
      fs.writeFileSync(path.join(sqldocDir, 'plugins', f), '// placeholder')
    }
    const loader = async (specifier: string) => ({
      default: plugins[path.basename(specifier) as keyof typeof plugins],
    })

    const result = await loadLocalPlugins(sqldocDir, loader)
    expect([...result.namespaces.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(result.errors).toEqual([])
  })

  it('rejects duplicate namespace names', async () => {
    fs.writeFileSync(path.join(sqldocDir, 'plugins', 'one.ts'), '//')
    fs.writeFileSync(path.join(sqldocDir, 'plugins', 'two.ts'), '//')
    const loader = makeLoader({
      [path.join(sqldocDir, 'plugins', 'one.ts')]: stubPlugin('dup'),
      [path.join(sqldocDir, 'plugins', 'two.ts')]: stubPlugin('dup'),
    })

    const result = await loadLocalPlugins(sqldocDir, loader)
    expect(result.namespaces.size).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain("Duplicate plugin namespace 'dup'")
  })

  it('rejects modules that do not export a valid TagNamespace', async () => {
    fs.writeFileSync(path.join(sqldocDir, 'plugins', 'bad.ts'), '//')
    const loader = async () => ({ default: { name: 'bad' } })

    const result = await loadLocalPlugins(sqldocDir, loader)
    expect(result.namespaces.size).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('does not export a valid TagNamespace')
  })

  it('caches results per sqldocDir', async () => {
    fs.writeFileSync(path.join(sqldocDir, 'plugins', 'p.ts'), '//')
    let calls = 0
    const loader = async () => {
      calls++
      return { default: stubPlugin('p') }
    }

    await loadLocalPlugins(sqldocDir, loader)
    await loadLocalPlugins(sqldocDir, loader)
    expect(calls).toBe(1)

    clearLocalPluginCache()
    await loadLocalPlugins(sqldocDir, loader)
    expect(calls).toBe(2)
  })
})

describe('loadImports() + .sqldoc/plugins integration', () => {
  let workdir: string
  let sqldocDir: string
  let sqlFile: string

  beforeEach(() => {
    clearLocalPluginCache()
    workdir = mkdtemp()
    sqldocDir = path.join(workdir, '.sqldoc')
    fs.mkdirSync(path.join(sqldocDir, 'plugins'), { recursive: true })
    sqlFile = path.join(workdir, 'schema.sql')
    fs.writeFileSync(sqlFile, '-- schema')
  })

  afterEach(() => {
    clearLocalPluginCache()
    fs.rmSync(workdir, { recursive: true, force: true })
  })

  it('auto-registers local plugins even when no @import is present', async () => {
    fs.writeFileSync(path.join(sqldocDir, 'plugins', 'local.ts'), '//')
    const loader = makeLoader({
      [path.join(sqldocDir, 'plugins', 'local.ts')]: stubPlugin('local'),
    })

    const result = await loadImports([], sqlFile, loader)
    expect([...result.namespaces.keys()]).toEqual(['local'])
  })

  it('@import merges alongside local plugins and overrides on name collision', async () => {
    fs.writeFileSync(path.join(sqldocDir, 'plugins', 'shared.ts'), '//')
    const sharedLocal = stubPlugin('shared')
    const sharedImported: TagNamespace = {
      name: 'shared',
      tags: { $self: { description: 'imported', targets: ['table'] } },
    }
    const loader = makeLoader({
      [path.join(sqldocDir, 'plugins', 'shared.ts')]: sharedLocal,
      [path.resolve(workdir, './override.ts')]: sharedImported,
    })

    const result = await loadImports(['./override.ts'], sqlFile, loader)
    expect(result.namespaces.size).toBe(1)
    expect(result.namespaces.get('shared')?.tags.$self?.description).toBe('imported')
  })
})
