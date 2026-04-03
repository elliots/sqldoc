import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, enrichRealm } from '../helpers/enrich.ts'
import { toCamelCase, toPascalCase, toScreamingSnake } from '../helpers/naming.ts'
import { pgToKotlin } from '../types/pg-to-kotlin.ts'

export default defineTemplate({
  name: 'Kotlin Data Classes',
  description: 'Generate Kotlin data classes from SQL schema',
  language: 'kotlin',

  generate(ctx) {
    const schema = enrichRealm(ctx)
    const classes: string[] = []

    // Enums
    for (const e of schema.enums) {
      const className = toPascalCase(e.name)
      const members = e.values.map((v) => `    ${toScreamingSnake(v)}`).join(',\n')
      classes.push(`enum class ${className} {\n${members}\n}`)
    }

    // Composite types as data classes
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
      const ktFields = fields.map((f) => {
        const ktType = pgToKotlin(f.type, false)
        return `    val ${toCamelCase(f.name)}: ${ktType}`
      })
      classes.push(`data class ${className}(`)
      classes.push(ktFields.join(',\n'))
      classes.push(')')
    }

    for (const table of activeTables(schema)) {
      const fields: string[] = []
      for (const col of table.columns) {
        let ktType: string
        if (col.typeOverride) {
          ktType = col.nullable ? `${col.typeOverride}?` : col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          ktType = col.nullable ? `${toPascalCase(col.pgType)}?` : toPascalCase(col.pgType)
        } else if (col.category === 'composite' && col.compositeFields?.length) {
          const compositeType = toPascalCase(col.pgType)
          ktType = col.nullable ? `${compositeType}?` : compositeType
        } else {
          ktType = pgToKotlin(col.pgType, col.nullable, col.category)
        }

        const defaultVal = col.nullable ? ' = null' : ''
        fields.push(`    val ${col.camelName}: ${ktType}${defaultVal}`)
      }

      classes.push(`data class ${table.pascalName}(`)
      classes.push(fields.join(',\n'))
      classes.push(')')
    }

    // Views (read-only — val only)
    for (const view of schema.views.filter((v) => !v.skipped && v.columns.length > 0)) {
      const fields: string[] = []
      for (const col of view.columns) {
        let ktType: string
        if (col.typeOverride) {
          ktType = col.nullable ? `${col.typeOverride}?` : col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          ktType = col.nullable ? `${toPascalCase(col.pgType)}?` : toPascalCase(col.pgType)
        } else if (col.category === 'composite' && col.compositeFields?.length) {
          const compositeType = toPascalCase(col.pgType)
          ktType = col.nullable ? `${compositeType}?` : compositeType
        } else {
          ktType = pgToKotlin(col.pgType, col.nullable, col.category)
        }

        const defaultVal = col.nullable ? ' = null' : ''
        fields.push(`    val ${col.camelName}: ${ktType}${defaultVal}`)
      }

      classes.push(`/** Read-only (from view) */`)
      classes.push(`data class ${view.pascalName}(`)
      classes.push(fields.join(',\n'))
      classes.push(')')
    }

    // Functions (skip trigger functions)
    for (const fn of schema.functions) {
      const retRaw = fn.returnType?.type?.toLowerCase() ?? ''
      if (retRaw === 'trigger') continue

      const params = fn.args
        .filter((a) => !a.name?.startsWith('_') && (a as any).mode !== 'OUT')
        .map((a) => {
          const argType = pgToKotlin(a.type, false, a.category)
          return `${toCamelCase(a.name || 'arg')}: ${argType}`
        })
        .join(', ')

      let retType: string
      if (retRaw.startsWith('setof ')) {
        const tableName = retRaw.replace('setof ', '')
        const table = schema.tables.find((t) => t.name === tableName || t.sqlName === tableName)
        retType = table ? `List<${table.pascalName}>` : `List<${pgToKotlin(tableName, false)}>`
      } else if (fn.returnType) {
        retType = pgToKotlin(fn.returnType.type, false, fn.returnType.category)
      } else {
        retType = 'Unit'
      }

      classes.push(`typealias ${fn.pascalName} = (${params}) -> ${retType}`)
    }

    if (classes.length === 0) {
      return { files: [] }
    }

    const imports = new Set<string>()
    // Check if any imported types are used in generated content
    const content = classes.join('\n')
    if (content.includes('BigDecimal')) imports.add('import java.math.BigDecimal')
    if (content.includes('OffsetDateTime')) imports.add('import java.time.OffsetDateTime')
    if (content.includes('LocalDateTime')) imports.add('import java.time.LocalDateTime')
    if (content.includes('LocalDate') && !content.includes('LocalDateTime')) imports.add('import java.time.LocalDate')
    if (content.includes('LocalTime')) imports.add('import java.time.LocalTime')
    if (content.includes('Duration')) imports.add('import java.time.Duration')
    if (content.includes('UUID')) imports.add('import java.util.UUID')

    const parts: string[] = []
    const sortedImports = [...imports].sort()
    if (sortedImports.length > 0) {
      parts.push(sortedImports.join('\n'))
      parts.push('')
    }
    parts.push(classes.join('\n\n'))
    parts.push('')

    return {
      files: [{ path: 'Models.kt', content: parts.join('\n') }],
    }
  },
})
