/**
 * Test helpers for namespace plugin tests.
 *
 * Import via `@sqldoc/core/test` — keeps test utilities out of the main barrel.
 */

import { dialectForEngine, resolveDatabaseEngine } from './dialects.ts'
import type { CompilerOutput, LintRule, NamespacePlugin, ProjectContext, TagContext } from './index.ts'

/** Create a minimal TagContext with sensible defaults */
export function makeTagCtx(overrides: Partial<TagContext> | Record<string, unknown> = {}): TagContext {
  const input = overrides as Partial<TagContext>
  const engine = resolveDatabaseEngine(
    { engine: input.engine ?? input.dialect ?? 'postgres', dialect: input.dialect },
    'makeTagCtx',
  )
  return {
    engine,
    dialect: dialectForEngine(engine),
    target: 'table',
    objectName: 'users',
    tag: { name: '$self', args: {} },
    namespaceTags: [],
    siblingTags: [],
    fileTags: [],
    astNode: null,
    fileStatements: [],
    config: {},
    filePath: 'test.sql',
    ...overrides,
  } as TagContext
}

/** Create a minimal ProjectContext with sensible defaults */
export function makeProjectCtx(overrides: Partial<ProjectContext> | Record<string, unknown> = {}): ProjectContext {
  const input = overrides as Partial<ProjectContext>
  const engine = resolveDatabaseEngine(
    { engine: input.engine ?? input.dialect ?? 'postgres', dialect: input.dialect },
    'makeProjectCtx',
  )
  return {
    engine,
    dialect: dialectForEngine(engine),
    outputs: [],
    mergedSql: '',
    allFileTags: [],
    docsMeta: [],
    config: {},
    projectRoot: '/tmp/test',
    schemaRealm: { schemas: [{ name: 'public', tables: [] }] },
    ...overrides,
  } as ProjectContext
}

/** Create a minimal CompilerOutput */
export function makeOutput(overrides: Partial<CompilerOutput> = {}): CompilerOutput {
  return {
    sourceFile: 'test.sql',
    mergedSql: '',
    sqlOutputs: [],
    codeOutputs: [],
    errors: [],
    docsMeta: [],
    fileTags: [],
    ...overrides,
  }
}

/** Create a minimal NamespacePlugin with optional lint rules */
export function makePlugin(name: string, lintRules: LintRule[] = []): NamespacePlugin {
  return {
    apiVersion: 1,
    name,
    tags: {},
    lintRules,
  }
}
