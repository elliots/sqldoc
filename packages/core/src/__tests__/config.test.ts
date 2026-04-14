import { describe, expect, it } from '@sqldoc/test-utils'
import { resolveAllProjects, resolveProject } from '../compiler/config.ts'

describe('resolveProject', () => {
  it('resolves engine-only config to both engine and dialect', () => {
    const config = resolveProject({
      engine: 'crdb',
      schema: 'schema.sql',
    })

    expect(config.engine).toBe('crdb')
    expect(config.dialect).toBe('postgres')
  })

  it('requires an engine in project config', () => {
    expect(() =>
      resolveProject({
        schema: 'schema.sql',
      }),
    ).toThrow('Project config requires an engine')
  })
})

describe('resolveAllProjects', () => {
  it('normalizes every project in a multi-project config', () => {
    const projects = resolveAllProjects([
      { name: 'main', engine: 'postgres', schema: 'schema.sql' },
      { name: 'analytics', engine: 'azuresql', schema: 'analytics.sql' },
    ])

    expect(projects).toHaveLength(2)
    expect(projects[0]).toMatchObject({ name: 'main', engine: 'postgres', dialect: 'postgres' })
    expect(projects[1]).toMatchObject({ name: 'analytics', engine: 'azuresql', dialect: 'mssql' })
  })
})
