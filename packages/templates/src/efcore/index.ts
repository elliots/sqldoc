import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, enrichRealm, type TagEntry } from '../helpers/enrich.ts'
import { toPascalCase } from '../helpers/naming.ts'
import { pgToCsharp } from '../types/pg-to-csharp.ts'

// C# reference types that get [Required] when non-nullable
const REFERENCE_TYPES = new Set(['string', 'byte[]', 'IPAddress'])

/**
 * Extract varchar length from pgType, e.g. varchar(255) -> 255
 */
function getVarcharLength(pgType: string): number | undefined {
  const match = pgType.match(/(?:varchar|character varying)\((\d+)\)/i)
  return match ? parseInt(match[1], 10) : undefined
}

/**
 * Generate EF Core data annotations from @validate tags.
 */
function getValidationAnnotations(colTags: TagEntry[]): string[] {
  const annotations: string[] = []

  for (const tag of colTags) {
    if (tag.namespace !== 'validate') continue

    if (tag.tag === 'length') {
      const args = tag.args as Record<string, unknown>
      if (args.max !== undefined) {
        annotations.push(`    [MaxLength(${args.max})]`)
      }
    } else if (tag.tag === 'range') {
      const args = tag.args as Record<string, unknown>
      const min = args.min ?? 0
      const max = args.max ?? 0
      annotations.push(`    [Range(${min}, ${max})]`)
    } else if (tag.tag === 'pattern') {
      const pattern = Array.isArray(tag.args) ? tag.args[0] : undefined
      if (pattern) {
        annotations.push(`    [RegularExpression(@"${pattern}")]`)
      }
    }
  }

  return annotations
}

export default defineTemplate({
  name: 'EF Core Entities',
  description: 'Generate Entity Framework Core entity classes with data annotations from SQL schema',
  language: 'csharp',

  generate(ctx) {
    const schema = enrichRealm(ctx)
    const classes: string[] = []

    // Enums
    for (const e of schema.enums) {
      const enumName = toPascalCase(e.name)
      const members = e.values.map((v) => `    ${toPascalCase(v)}`).join(',\n')
      classes.push(`public enum ${enumName}\n{\n${members}\n}`)
    }

    // Composite types as [Owned] classes
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
      const propertyLines: string[] = []
      for (const f of fields) {
        const csType = pgToCsharp(f.type, false)
        propertyLines.push(`    public ${csType} ${toPascalCase(f.name)} { get; set; }`)
        propertyLines.push('')
      }

      classes.push(`[Owned]`)
      classes.push(`public class ${className}`)
      classes.push('{')
      classes.push(propertyLines.join('\n'))
      classes.push('}')
    }

    for (const table of activeTables(schema)) {
      const propertyLines: string[] = []
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

        const annotations: string[] = []

        // PK annotation
        if (col.isPrimaryKey) {
          annotations.push('    [Key]')
        }

        // FK annotation
        if (col.foreignKey) {
          annotations.push(`    [ForeignKey("${col.pascalName}")]`)
        }

        // Required for non-nullable reference types
        const baseType = csType.replace('?', '')
        if (!col.nullable && REFERENCE_TYPES.has(baseType) && !col.isPrimaryKey) {
          annotations.push('    [Required]')
        }

        // MaxLength for varchar
        const varcharLen = getVarcharLength(col.pgType)
        if (varcharLen) {
          annotations.push(`    [MaxLength(${varcharLen})]`)
        }

        // Validation annotations from @validate tags
        const validationAnnotations = getValidationAnnotations(col.tags)
        annotations.push(...validationAnnotations)

        if (annotations.length > 0) {
          propertyLines.push(annotations.join('\n'))
        }
        propertyLines.push(`    public ${csType} ${col.pascalName} { get; set; }`)
        propertyLines.push('')
      }

      classes.push(`public class ${table.pascalName}`)
      classes.push('{')
      classes.push(propertyLines.join('\n'))
      classes.push('}')
    }

    // Views (read-only — [Keyless] entities)
    for (const view of schema.views.filter((v) => !v.skipped)) {
      const propertyLines: string[] = []
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

        propertyLines.push(`    public ${csType} ${col.pascalName} { get; }`)
        propertyLines.push('')
      }

      classes.push(`/// <summary>Read-only (from view)</summary>`)
      classes.push(`[Keyless]`)
      classes.push(`public class ${view.pascalName}`)
      classes.push('{')
      classes.push(propertyLines.join('\n'))
      classes.push('}')
    }

    if (classes.length === 0) {
      return { files: [] }
    }

    const parts: string[] = []
    parts.push('using System.ComponentModel.DataAnnotations;')
    parts.push('using System.ComponentModel.DataAnnotations.Schema;')
    parts.push('using Microsoft.EntityFrameworkCore;')
    parts.push('')
    parts.push('namespace Generated;')
    parts.push('')
    parts.push(classes.join('\n\n'))
    parts.push('')

    return {
      files: [{ path: 'Models.cs', content: parts.join('\n') }],
    }
  },
})
