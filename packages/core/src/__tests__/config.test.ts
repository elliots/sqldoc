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

  it('resolves dialect-only config to a matching default engine', () => {
    const config = resolveProject({
      dialect: 'mysql',
      schema: 'schema.sql',
    })

    expect(config.engine).toBe('mysql')
    expect(config.dialect).toBe('mysql')
  })

  it('rejects mismatched engine and dialect combinations', () => {
    expect(() =>
      resolveProject({
        engine: 'tidb',
        dialect: 'postgres',
      }),
    ).toThrow('engine "tidb" belongs to dialect "mysql", got "postgres"')
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
