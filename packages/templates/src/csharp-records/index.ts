import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, enrichRealm } from '../helpers/enrich.ts'
import { toPascalCase } from '../helpers/naming.ts'
import { pgToCsharp } from '../types/pg-to-csharp.ts'

export default defineTemplate({
  name: 'C# Records',
  description: 'Generate C# record types from SQL schema',
  language: 'csharp',

  generate(ctx) {
    const schema = enrichRealm(ctx)
    const records: string[] = []

    // Enums
    for (const e of schema.enums) {
      const enumName = toPascalCase(e.name)
      const members = e.values.map((v) => `    ${toPascalCase(v)}`).join(',\n')
      records.push(`public enum ${enumName}\n{\n${members}\n}`)
    }

    // Composite types as records
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
      const csFields = fields.map((f) => {
        const csType = pgToCsharp(f.type, false)
        return `    ${csType} ${toPascalCase(f.name)}`
      })
      records.push(`public record ${className}(`)
      records.push(csFields.join(',\n'))
      records.push(');')
    }

    for (const table of activeTables(schema)) {
      const params: string[] = []
      for (const col of table.columns) {
        let csType: string
        if (col.typeOverride) {
          csType = col.nullable ? `${col.typeOverride}?` : col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          csType = col.nullable ? `${toPascalCase(col.pgType)}?` : toPascalCase(col.pgType)
        } else if (col.category === 'composite' && col.compositeFields?.length) {
          const compositeType = toPascalCase(col.pgType)
          csType = col.nullable ? `${compositeType}?` : compositeType
        } else {
          csType = pgToCsharp(col.pgType, col.nullable, col.category)
        }

        params.push(`    ${csType} ${col.pascalName}`)
      }

      records.push(`public record ${table.pascalName}(`)
      records.push(params.join(',\n'))
      records.push(');')
    }

    // Views (read-only)
    for (const view of schema.views.filter((v) => !v.skipped)) {
      const params: string[] = []
      for (const col of view.columns) {
        let csType: string
        if (col.typeOverride) {
          csType = col.nullable ? `${col.typeOverride}?` : col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          csType = col.nullable ? `${toPascalCase(col.pgType)}?` : toPascalCase(col.pgType)
        } else if (col.category === 'composite' && col.compositeFields?.length) {
          const compositeType = toPascalCase(col.pgType)
          csType = col.nullable ? `${compositeType}?` : compositeType
        } else {
          csType = pgToCsharp(col.pgType, col.nullable, col.category)
        }

        params.push(`    ${csType} ${col.pascalName}`)
      }

      records.push(`/// <summary>Read-only (from view)</summary>`)
      records.push(`public record ${view.pascalName}(`)
      records.push(params.join(',\n'))
      records.push(');')
    }

    // Functions (skip trigger functions)
    for (const fn of schema.functions) {
      const retRaw = fn.returnType?.type?.toLowerCase() ?? ''
      if (retRaw === 'trigger') continue

      let retType: string
      if (retRaw.startsWith('setof ')) {
        const tableName = retRaw.replace('setof ', '')
        const table = schema.tables.find((t) => t.name === tableName || t.sqlName === tableName)
        retType = table ? `IEnumerable<${table.pascalName}>` : `IEnumerable<${toPascalCase(tableName)}>`
      } else if (fn.returnType) {
        retType = pgToCsharp(fn.returnType.type, false, fn.returnType.category)
      } else {
        retType = 'void'
      }

      const argParts = fn.args
        .filter((a) => !a.name?.startsWith('_') && (a as any).mode !== 'OUT')
        .map((a) => {
          const csType = pgToCsharp(a.type, false, a.category)
          const paramName = toPascalCase(a.name || 'arg').replace(/^./, (c) => c.toLowerCase()) // lowerCamelCase
          return `${csType} ${paramName}`
        })

      records.push(`public delegate ${retType} ${fn.pascalName}(${argParts.join(', ')});`)
    }

    if (records.length === 0) {
      return { files: [] }
    }

    const parts: string[] = []
    parts.push('namespace Generated;')
    parts.push('')
    parts.push(records.join('\n\n'))
    parts.push('')

    return {
      files: [{ path: 'Models.cs', content: parts.join('\n') }],
    }
  },
})
