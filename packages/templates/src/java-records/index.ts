import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, enrichRealm } from '../helpers/enrich.ts'
import { toCamelCase, toPascalCase, toScreamingSnake } from '../helpers/naming.ts'
import { pgToJava } from '../types/pg-to-java.ts'

export default defineTemplate({
  name: 'Java Records',
  description: 'Generate Java record classes from SQL schema',
  language: 'java',

  generate(ctx) {
    const schema = enrichRealm(ctx)
    const files: Array<{ path: string; content: string }> = []

    // Enums
    for (const e of schema.enums) {
      const className = toPascalCase(e.name)
      const members = e.values.map((v) => {
        const constName = toScreamingSnake(v)
        return `    ${constName}("${v}")`
      })

      const parts: string[] = []
      parts.push(`public enum ${className} {`)
      parts.push(`${members.join(',\n')};`)
      parts.push('')
      parts.push(`    private final String value;`)
      parts.push('')
      parts.push(`    ${className}(String value) {`)
      parts.push(`        this.value = value;`)
      parts.push(`    }`)
      parts.push('')
      parts.push(`    public String getValue() {`)
      parts.push(`        return value;`)
      parts.push(`    }`)
      parts.push('}')
      parts.push('')

      files.push({
        path: `${className}.java`,
        content: parts.join('\n'),
      })
    }

    // Composite types (collected from columns)
    const composites = new Map<string, Array<{ name: string; type: string }>>()
    for (const table of schema.tables) {
      for (const col of table.columns) {
        if (col.category === 'composite' && col.compositeFields?.length && !composites.has(col.pgType)) {
          composites.set(col.pgType, col.compositeFields)
        }
      }
    }
    for (const [name, fields] of composites) {
      const className = toPascalCase(name)
      const allImports = new Set<string>()

      const recordFields: string[] = []
      for (const f of fields) {
        const mapped = pgToJava(f.type, false)
        for (const imp of mapped.imports) allImports.add(imp)
        recordFields.push(`    ${mapped.type} ${toCamelCase(f.name)}`)
      }

      const importLines: string[] = []
      const sortedImports = [...allImports].sort((a, b) => a.localeCompare(b))
      for (const imp of sortedImports) {
        importLines.push(`import ${imp};`)
      }

      const parts: string[] = []
      if (importLines.length > 0) {
        parts.push(importLines.join('\n'))
        parts.push('')
      }
      parts.push(`public record ${className}(`)
      parts.push(recordFields.join(',\n'))
      parts.push(') {}')
      parts.push('')

      files.push({
        path: `${className}.java`,
        content: parts.join('\n'),
      })
    }

    for (const table of activeTables(schema)) {
      const allImports = new Set<string>()

      const fields: string[] = []
      for (const col of table.columns) {
        let javaType: string
        if (col.typeOverride) {
          javaType = col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          javaType = toPascalCase(col.pgType)
        } else if (col.category === 'composite' && col.compositeFields?.length) {
          javaType = toPascalCase(col.pgType)
        } else {
          const mapped = pgToJava(col.pgType, col.nullable, col.category)
          javaType = mapped.type
          for (const imp of mapped.imports) allImports.add(imp)
        }

        fields.push(`    ${javaType} ${col.camelName}`)
      }

      const importLines: string[] = []
      const sortedImports = [...allImports].sort((a, b) => a.localeCompare(b))
      for (const imp of sortedImports) {
        importLines.push(`import ${imp};`)
      }

      const parts: string[] = []
      if (importLines.length > 0) {
        parts.push(importLines.join('\n'))
        parts.push('')
      }
      parts.push(`public record ${table.pascalName}(`)
      parts.push(fields.join(',\n'))
      parts.push(') {}')
      parts.push('')

      files.push({
        path: `${table.pascalName}.java`,
        content: parts.join('\n'),
      })
    }

    // Views (read-only)
    for (const view of schema.views.filter((v) => !v.skipped)) {
      const allImports = new Set<string>()

      const fields: string[] = []
      for (const col of view.columns) {
        let javaType: string
        if (col.typeOverride) {
          javaType = col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          javaType = toPascalCase(col.pgType)
        } else if (col.category === 'composite' && col.compositeFields?.length) {
          javaType = toPascalCase(col.pgType)
        } else {
          const mapped = pgToJava(col.pgType, col.nullable, col.category)
          javaType = mapped.type
          for (const imp of mapped.imports) allImports.add(imp)
        }

        fields.push(`    ${javaType} ${col.camelName}`)
      }

      const importLines: string[] = []
      const sortedImports = [...allImports].sort((a, b) => a.localeCompare(b))
      for (const imp of sortedImports) {
        importLines.push(`import ${imp};`)
      }

      const parts: string[] = []
      if (importLines.length > 0) {
        parts.push(importLines.join('\n'))
        parts.push('')
      }
      parts.push(`/** Read-only (from view) */`)
      parts.push(`public record ${view.pascalName}(`)
      parts.push(fields.join(',\n'))
      parts.push(') {}')
      parts.push('')

      files.push({
        path: `${view.pascalName}.java`,
        content: parts.join('\n'),
      })
    }

    // Functions (skip trigger functions — Java doesn't have SQL function type patterns)

    return { files }
  },
})
