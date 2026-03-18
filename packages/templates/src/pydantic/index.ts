import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, enrichRealm, type TagEntry } from '../helpers/enrich.ts'
import { toPascalCase, toScreamingSnake } from '../helpers/naming.ts'
import { pgToPython } from '../types/pg-to-python.ts'

/** Python imports needed for specific types */
const TYPE_IMPORTS: Record<string, string> = {
  datetime: 'from datetime import datetime',
  date: 'from datetime import date',
  time: 'from datetime import time',
  timedelta: 'from datetime import timedelta',
  Decimal: 'from decimal import Decimal',
  UUID: 'from uuid import UUID',
  Any: 'from typing import Any',
}

export default defineTemplate({
  name: 'Pydantic Models',
  description: 'Generate Pydantic BaseModel classes with Field validators from SQL schema',
  language: 'python',

  generate(ctx) {
    const schema = enrichRealm(ctx)
    const allImports = new Set<string>()
    allImports.add('from pydantic import BaseModel, Field')
    const needsOptional = new Set<boolean>()
    const needsEnum = schema.enums.length > 0
    const needsCallable = { value: false }
    const classBlocks: string[] = []

    // Enums
    for (const e of schema.enums) {
      const className = toPascalCase(e.name)
      const members = e.values.map((v) => `    ${toScreamingSnake(v)} = "${v}"`).join('\n')
      classBlocks.push(`class ${className}(str, Enum):\n${members}`)
    }

    // Composite types (collected from columns, rendered as BaseModel)
    const composites = new Map<string, Array<{ name: string; type: string }>>()
    for (const table of schema.tables) {
      for (const col of table.columns) {
        if (col.category === 'composite' && col.compositeFields?.length && !composites.has(col.pgType)) {
          composites.set(col.pgType, col.compositeFields)
        }
      }
    }
    for (const [name, fields] of composites) {
      const typeName = toPascalCase(name)
      const fieldLines: string[] = []
      for (const f of fields) {
        const pyType = pgToPython(f.type, false)
        collectImports(pyType, allImports)
        fieldLines.push(`    ${f.name}: ${pyType}`)
      }
      classBlocks.push(`class ${typeName}(BaseModel):\n${fieldLines.join('\n')}`)
    }

    for (const table of activeTables(schema)) {
      const requiredFields: string[] = []
      const optionalFields: string[] = []

      for (const col of table.columns) {
        let pyType: string

        if (col.typeOverride) {
          pyType = col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          const enumName = toPascalCase(col.pgType)
          pyType = col.nullable ? `Optional[${enumName}]` : enumName
        } else if (col.category === 'composite' && col.compositeFields?.length) {
          const compositeType = toPascalCase(col.pgType)
          pyType = col.nullable ? `Optional[${compositeType}]` : compositeType
        } else {
          pyType = pgToPython(col.pgType, col.nullable, col.category)
        }

        collectImports(pyType, allImports)

        // Build Field() arguments from @validate tags
        const fieldArgs = buildFieldArgs(col.tags)

        if (col.nullable) {
          needsOptional.add(true)
          if (fieldArgs) {
            optionalFields.push(`    ${col.name}: ${pyType} = Field(default=None, ${fieldArgs})`)
          } else {
            optionalFields.push(`    ${col.name}: ${pyType} = None`)
          }
        } else {
          if (fieldArgs) {
            requiredFields.push(`    ${col.name}: ${pyType} = Field(${fieldArgs})`)
          } else {
            requiredFields.push(`    ${col.name}: ${pyType}`)
          }
        }
      }

      const fields = [...requiredFields, ...optionalFields]
      classBlocks.push(`class ${table.pascalName}(BaseModel):\n${fields.join('\n')}`)
    }

    // Views (read-only, frozen BaseModel)
    for (const view of schema.views.filter((v) => !v.skipped)) {
      const requiredFields: string[] = []
      const optionalFields: string[] = []

      for (const col of view.columns) {
        let pyType: string

        if (col.typeOverride) {
          pyType = col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          const enumName = toPascalCase(col.pgType)
          pyType = col.nullable ? `Optional[${enumName}]` : enumName
        } else if (col.category === 'composite' && col.compositeFields?.length) {
          const compositeType = toPascalCase(col.pgType)
          pyType = col.nullable ? `Optional[${compositeType}]` : compositeType
        } else {
          pyType = pgToPython(col.pgType, col.nullable, col.category)
        }

        collectImports(pyType, allImports)

        const fieldArgs = buildFieldArgs(col.tags)

        if (col.nullable) {
          needsOptional.add(true)
          if (fieldArgs) {
            optionalFields.push(`    ${col.name}: ${pyType} = Field(default=None, ${fieldArgs})`)
          } else {
            optionalFields.push(`    ${col.name}: ${pyType} = None`)
          }
        } else {
          if (fieldArgs) {
            requiredFields.push(`    ${col.name}: ${pyType} = Field(${fieldArgs})`)
          } else {
            requiredFields.push(`    ${col.name}: ${pyType}`)
          }
        }
      }

      const fields = [...requiredFields, ...optionalFields]
      const configLine = `\n\n    class Config:\n        frozen = True`
      classBlocks.push(
        `class ${view.pascalName}(BaseModel):\n    """Read-only (from view)"""\n${fields.join('\n')}${configLine}`,
      )
    }

    // Functions (skip trigger functions)
    const funcLines: string[] = []
    for (const fn of schema.functions) {
      const retRaw = fn.returnType?.type?.toLowerCase() ?? ''
      if (retRaw === 'trigger') continue

      needsCallable.value = true

      const params = fn.args
        .filter((a) => !a.name?.startsWith('_') && (a as any).mode !== 'OUT')
        .map((a) => {
          const argType = pgToPython(a.type, false, a.category)
          collectImports(argType, allImports)
          return argType
        })

      let retType: string
      if (retRaw.startsWith('setof ')) {
        const tableName = retRaw.replace('setof ', '')
        const table = schema.tables.find((t) => t.name === tableName)
        retType = table ? `list[${table.pascalName}]` : `list[${pgToPython(tableName, false)}]`
      } else if (fn.returnType) {
        retType = pgToPython(fn.returnType.type, false, fn.returnType.category)
      } else {
        retType = 'None'
      }
      collectImports(retType, allImports)

      funcLines.push(`${fn.pascalName}: Callable[[${params.join(', ')}], ${retType}]`)
    }

    if (needsOptional.has(true)) {
      allImports.add('from typing import Optional')
    }
    if (needsEnum) {
      allImports.add('from enum import Enum')
    }
    if (needsCallable.value) {
      allImports.add('from typing import Callable')
    }

    const sortedImports = sortPythonImports([...allImports])

    const allBlocks = [...classBlocks]
    if (funcLines.length > 0) {
      allBlocks.push(funcLines.join('\n'))
    }

    const content = `# Generated by @sqldoc/templates/pydantic -- DO NOT EDIT

${sortedImports.join('\n')}


${allBlocks.join('\n\n\n')}
`

    return {
      files: [{ path: 'models.py', content }],
    }
  },
})

function buildFieldArgs(tags: TagEntry[]): string | undefined {
  const validateTags = tags.filter((t) => t.namespace === 'validate')
  if (validateTags.length === 0) return undefined

  const parts: string[] = []

  for (const tag of validateTags) {
    switch (tag.tag) {
      case 'notEmpty':
        parts.push('min_length=1')
        break
      case 'length': {
        const args = tag.args as Record<string, unknown>
        if (args && typeof args === 'object' && !Array.isArray(args)) {
          if ('min' in args) parts.push(`min_length=${args.min}`)
          if ('max' in args) parts.push(`max_length=${args.max}`)
        }
        break
      }
      case 'range': {
        const args = tag.args as Record<string, unknown>
        if (args && typeof args === 'object' && !Array.isArray(args)) {
          if ('min' in args) parts.push(`ge=${args.min}`)
          if ('max' in args) parts.push(`le=${args.max}`)
        }
        break
      }
      case 'pattern': {
        const args = tag.args
        if (Array.isArray(args) && args.length > 0) {
          parts.push(`pattern='${args[0]}'`)
        }
        break
      }
    }
  }

  return parts.length > 0 ? parts.join(', ') : undefined
}

function collectImports(pyType: string, imports: Set<string>): void {
  const match = pyType.match(/^Optional\[(.+)\]$/)
  const baseType = match ? match[1] : pyType
  const listMatch = baseType.match(/^list\[(.+)\]$/)
  const innerType = listMatch ? listMatch[1] : baseType

  if (TYPE_IMPORTS[innerType]) {
    imports.add(TYPE_IMPORTS[innerType])
  }
}

function sortPythonImports(imports: string[]): string[] {
  return imports.sort((a, b) => {
    if (a.includes('pydantic')) return -1
    if (b.includes('pydantic')) return 1
    if (a.includes('typing')) return -1
    if (b.includes('typing')) return 1
    if (a.includes('enum')) return -1
    if (b.includes('enum')) return 1
    return a.localeCompare(b)
  })
}
