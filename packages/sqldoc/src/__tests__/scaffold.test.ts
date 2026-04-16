import { describe, expect, it } from '@sqldoc/test-utils'
import { namespacesToInstall, scaffoldConfig, scaffoldExample } from '../scaffold.ts'

describe('scaffoldConfig', () => {
  it('generates minimal config with default postgres engine', () => {
    const result = scaffoldConfig({ engine: 'postgres', namespaces: [], templates: [] })
    expect(result).toContain("import type { SqldocConfig } from './.sqldoc/config'")
    expect(result).toContain('const config: SqldocConfig')
    expect(result).toContain('export default config')
    expect(result).toContain("engine: 'postgres'")
    expect(result).not.toContain('dialect:')
    // Should have devUrl hint
    expect(result).toContain('// devUrl:')
  })

  it('sets engine for non-default', () => {
    const result = scaffoldConfig({ engine: 'mysql', namespaces: [], templates: [] })
    expect(result).toContain("engine: 'mysql'")
    expect(result).not.toContain('dialect:')
    expect(result).toContain('mysql://localhost')
  })

  it('includes namespace config sections', () => {
    const result = scaffoldConfig({ engine: 'postgres', namespaces: ['audit', 'validate'], templates: [] })
    expect(result).toContain('namespaces: {')
    expect(result).toContain('audit: {}')
    expect(result).toContain('validate: {}')
  })

  it('includes docs config with defaults', () => {
    const result = scaffoldConfig({ engine: 'postgres', namespaces: ['docs'], templates: [] })
    expect(result).toContain("format: 'html'")
    expect(result).toContain("output: 'docs/schema.html'")
  })

  it('includes codegen config with templates', () => {
    const result = scaffoldConfig({ engine: 'postgres', namespaces: ['codegen'], templates: ['typescript', 'zod'] })
    expect(result).toContain('templates: [')
    expect(result).toContain("'@sqldoc/templates/typescript'")
    expect(result).toContain("'@sqldoc/templates/zod'")
    expect(result).toContain("'generated/types.ts'")
    expect(result).toContain("'generated/schemas.ts'")
  })

  it('generates sqlite config', () => {
    const result = scaffoldConfig({ engine: 'sqlite', namespaces: [], templates: [] })
    expect(result).toContain("engine: 'sqlite'")
    expect(result).toContain('sqlite://dev.db')
  })
})

describe('scaffoldExample', () => {
  it('generates imports for selected namespaces', () => {
    const result = scaffoldExample({ engine: 'postgres', namespaces: ['audit', 'validate'], templates: [] })
    expect(result).toContain('-- @import @sqldoc/ns-audit')
    expect(result).toContain('-- @import @sqldoc/ns-validate')
  })

  it('includes table-level tags', () => {
    const result = scaffoldExample({ engine: 'postgres', namespaces: ['audit', 'rls'], templates: [] })
    expect(result).toContain('-- @audit')
    expect(result).toContain('-- @rls')
    expect(result).toContain('CREATE TABLE users')
  })

  it('includes column-level tags', () => {
    const result = scaffoldExample({ engine: 'postgres', namespaces: ['validate'], templates: [] })
    expect(result).toContain('@validate.check')
  })

  it('includes anon tags', () => {
    const result = scaffoldExample({ engine: 'postgres', namespaces: ['anon'], templates: [] })
    expect(result).toContain('@anon.mask')
  })

  it('adapts to mysql dialect', () => {
    const result = scaffoldExample({ engine: 'mysql', namespaces: ['validate'], templates: [] })
    expect(result).toContain('INT AUTO_INCREMENT')
    expect(result).toContain('VARCHAR(255)')
  })

  it('adapts to sqlite dialect', () => {
    const result = scaffoldExample({ engine: 'sqlite', namespaces: ['validate'], templates: [] })
    expect(result).toContain('INTEGER')
    expect(result).toContain('TEXT DEFAULT CURRENT_TIMESTAMP')
  })

  it('generates rls policy example for postgres', () => {
    const result = scaffoldExample({ engine: 'postgres', namespaces: ['rls'], templates: [] })
    expect(result).toContain('@rls.policy')
  })
})

describe('namespacesToInstall', () => {
  it('always includes @sqldoc/cli', () => {
    expect(namespacesToInstall([], [])).toContain('@sqldoc/cli')
  })

  it('maps namespace names to packages', () => {
    const result = namespacesToInstall(['audit', 'validate'], [])
    expect(result).toContain('@sqldoc/ns-audit')
    expect(result).toContain('@sqldoc/ns-validate')
  })

  it('includes templates package when codegen has templates', () => {
    const result = namespacesToInstall(['codegen'], ['typescript'])
    expect(result).toContain('@sqldoc/ns-codegen')
    expect(result).toContain('@sqldoc/templates')
  })

  it('does not include templates when codegen has no templates', () => {
    const result = namespacesToInstall(['codegen'], [])
    expect(result).toContain('@sqldoc/ns-codegen')
    expect(result).not.toContain('@sqldoc/templates')
  })
})
