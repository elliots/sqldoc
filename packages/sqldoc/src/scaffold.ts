/**
 * Scaffolding helpers for `sqldoc init`.
 * Generates sqldoc.config.ts and example.sql based on user choices.
 */

type Dialect = 'postgres' | 'mysql' | 'sqlite'

interface ScaffoldOptions {
  dialect: Dialect
  namespaces: string[]
  templates: string[]
}

/**
 * Generate sqldoc.config.ts content based on user selections.
 */
export function scaffoldConfig(opts: ScaffoldOptions): string {
  const lines: string[] = []

  // Imports
  lines.push(`import type { SqldocConfig } from './.sqldoc/config'`)
  lines.push('')

  // Config object
  lines.push('const config: SqldocConfig = {')

  // Dialect (mandatory)
  lines.push(`  dialect: '${opts.dialect}',`)

  // Dev URL hint
  const devUrlHint = devUrlForDialect(opts.dialect)
  lines.push(`  // devUrl: '${devUrlHint}',`)

  // Namespaces
  if (opts.namespaces.length > 0) {
    lines.push('  namespaces: {')

    for (const ns of opts.namespaces) {
      const nsConfig = namespaceConfigSnippet(ns, opts.templates)
      if (nsConfig) {
        lines.push(`    ${ns}: ${nsConfig},`)
      } else {
        lines.push(`    ${ns}: {},`)
      }
    }

    lines.push('  },')
  }

  lines.push('}')
  lines.push('')
  lines.push('export default config')
  lines.push('')

  return lines.join('\n')
}

function devUrlForDialect(dialect: Dialect): string {
  switch (dialect) {
    case 'postgres':
      return 'postgres://localhost:5432/mydb?sslmode=disable'
    case 'mysql':
      return 'mysql://localhost:3306/mydb'
    case 'sqlite':
      return 'sqlite://dev.db'
  }
}

function namespaceConfigSnippet(ns: string, templates: string[]): string | null {
  switch (ns) {
    case 'docs':
      return `{\n      format: 'html',\n      output: 'docs/schema.html',\n      title: 'Schema Documentation',\n    }`
    case 'codegen': {
      if (templates.length === 0) return null
      const entries = templates.map((t) => {
        const output = templateOutput(t)
        return `        { template: '@sqldoc/templates/${t}', output: '${output}' },`
      })
      return `{\n      templates: [\n${entries.join('\n')}\n      ],\n    }`
    }
    default:
      return null
  }
}

function templateOutput(template: string): string {
  switch (template) {
    case 'typescript':
      return 'generated/types.ts'
    case 'zod':
      return 'generated/schemas.ts'
    case 'drizzle':
      return 'generated/drizzle.ts'
    case 'prisma':
      return 'generated/schema.prisma'
    case 'kysely':
      return 'generated/database.ts'
    case 'go-structs':
      return 'generated/models.go'
    case 'gorm':
      return 'generated/models.go'
    case 'sqlc':
      return 'generated/models.go'
    case 'python-dataclasses':
      return 'generated/models.py'
    case 'pydantic':
      return 'generated/models.py'
    case 'sqlalchemy':
      return 'generated/models.py'
    case 'java-records':
      return 'generated/Models.java'
    case 'jpa':
      return 'generated/Models.java'
    case 'kotlin-data':
      return 'generated/Models.kt'
    case 'rust-structs':
      return 'generated/models.rs'
    case 'diesel':
      return 'generated/models.rs'
    case 'csharp-records':
      return 'generated/Models.cs'
    case 'efcore':
      return 'generated/Models.cs'
    case 'json-schema':
      return 'generated/schema.json'
    case 'protobuf':
      return 'generated/schema.proto'
    default:
      return `generated/${template}`
  }
}

/**
 * Generate example.sql content based on selected namespaces and dialect.
 */
export function scaffoldExample(opts: ScaffoldOptions): string {
  const lines: string[] = []

  lines.push(`-- Example SQL file demonstrating sqldoc tags`)
  lines.push(`-- See: https://sqldoc.dev/docs`)
  lines.push('')

  // Imports for selected namespaces
  for (const ns of opts.namespaces) {
    lines.push(`-- @import ${nsPackage(ns)}`)
  }
  if (opts.namespaces.length > 0) lines.push('')

  // Table with tags for selected namespaces
  lines.push(tableExample(opts))

  return lines.join('\n')
}

function nsPackage(ns: string): string {
  return `@sqldoc/ns-${ns}`
}

function tableExample(opts: ScaffoldOptions): string {
  const lines: string[] = []
  const hasNs = (ns: string) => opts.namespaces.includes(ns)

  // Table-level tags
  const tableTags: string[] = []
  if (hasNs('audit')) tableTags.push('-- @audit')
  if (hasNs('rls')) tableTags.push('-- @rls')
  if (hasNs('docs')) tableTags.push('-- @docs.description("User accounts")')

  if (tableTags.length > 0) {
    lines.push(tableTags.join('\n'))
  }

  const idType = opts.dialect === 'mysql' ? 'INT AUTO_INCREMENT' : opts.dialect === 'sqlite' ? 'INTEGER' : 'SERIAL'
  const textType = opts.dialect === 'mysql' ? 'VARCHAR(255)' : 'TEXT'
  const timestampType =
    opts.dialect === 'mysql'
      ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
      : opts.dialect === 'sqlite'
        ? 'TEXT DEFAULT CURRENT_TIMESTAMP'
        : 'TIMESTAMPTZ DEFAULT now()'

  lines.push('CREATE TABLE users (')

  const columns: string[] = []
  columns.push(`  id ${idType} PRIMARY KEY`)

  // Email column with tags
  const emailTags: string[] = []
  if (hasNs('validate')) emailTags.push('  -- @validate.check("email ~* \'^.+@.+$\'")')
  if (hasNs('anon')) emailTags.push('  -- @anon.mask("anon.fake_email()")')
  if (hasNs('codegen')) emailTags.push('  -- @codegen.type("string")')
  if (emailTags.length > 0) columns.push(emailTags.join('\n'))
  columns.push(`  email ${textType} NOT NULL`)

  // Name column
  if (hasNs('anon')) columns.push('  -- @anon.mask("anon.fake_first_name()")')
  columns.push(`  name ${textType}`)

  // Created at
  if (hasNs('docs')) columns.push('  -- @docs.description("When the user signed up")')
  columns.push(`  created_at ${timestampType}`)

  lines.push(columns.join(',\n'))
  lines.push(');')
  lines.push('')

  // RLS policy example
  if (hasNs('rls') && opts.dialect === 'postgres') {
    lines.push('-- @rls.policy(name: "users_own_data", for: "all", using: "auth.uid() = id")')
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * List of namespace packages to install for selected namespaces.
 */
export function namespacesToInstall(namespaces: string[], templates: string[]): string[] {
  const packages: string[] = ['@sqldoc/cli']

  for (const ns of namespaces) {
    packages.push(`@sqldoc/ns-${ns}`)
  }

  if (namespaces.includes('codegen') && templates.length > 0) {
    packages.push('@sqldoc/templates')
  }

  return packages
}
