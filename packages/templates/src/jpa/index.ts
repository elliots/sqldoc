import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, enrichRealm, type TagEntry } from '../helpers/enrich.ts'
import { toCamelCase, toPascalCase, toScreamingSnake } from '../helpers/naming.ts'
import { pgToJava } from '../types/pg-to-java.ts'

/**
 * Extract varchar length from pgType, e.g. varchar(255) -> 255
 */
function getVarcharLength(pgType: string): number | undefined {
  const match = pgType.match(/(?:varchar|character varying)\((\d+)\)/i)
  return match ? parseInt(match[1], 10) : undefined
}

/**
 * Generate validation annotations from @validate tags.
 */
function getValidationAnnotations(colTags: TagEntry[]): { annotations: string[]; imports: Set<string> } {
  const annotations: string[] = []
  const imports = new Set<string>()

  for (const tag of colTags) {
    if (tag.namespace !== 'validate') continue

    if (tag.tag === 'notEmpty') {
      annotations.push('@NotEmpty')
      imports.add('jakarta.validation.constraints.NotEmpty')
    } else if (tag.tag === 'length') {
      const args = tag.args as Record<string, unknown>
      const parts: string[] = []
      if (args.min !== undefined) parts.push(`min = ${args.min}`)
      if (args.max !== undefined) parts.push(`max = ${args.max}`)
      annotations.push(`@Size(${parts.join(', ')})`)
      imports.add('jakarta.validation.constraints.Size')
    } else if (tag.tag === 'range') {
      const args = tag.args as Record<string, unknown>
      if (args.min !== undefined) {
        annotations.push(`@Min(${args.min})`)
        imports.add('jakarta.validation.constraints.Min')
      }
      if (args.max !== undefined) {
        annotations.push(`@Max(${args.max})`)
        imports.add('jakarta.validation.constraints.Max')
      }
    } else if (tag.tag === 'pattern') {
      const pattern = Array.isArray(tag.args) ? tag.args[0] : undefined
      if (pattern) {
        // Escape backslashes for Java string literals
        const escaped = pattern.replace(/\\/g, '\\\\')
        annotations.push(`@Pattern(regexp = "${escaped}")`)
        imports.add('jakarta.validation.constraints.Pattern')
      }
    }
  }

  return { annotations, imports }
}

export default defineTemplate({
  name: 'JPA Entities',
  description: 'Generate JPA @Entity classes with annotations from SQL schema',
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

    // Composite types as @Embeddable classes
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
      allImports.add('jakarta.persistence.Embeddable')

      const fieldLines: string[] = []
      for (const f of fields) {
        const mapped = pgToJava(f.type, false)
        for (const imp of mapped.imports) allImports.add(imp)
        fieldLines.push(`    private ${mapped.type} ${toCamelCase(f.name)};`)
        fieldLines.push('')
      }

      const sortedImports = [...allImports].sort()
      const importLines = sortedImports.map((imp) => `import ${imp};`)

      const parts: string[] = []
      parts.push(importLines.join('\n'))
      parts.push('')
      parts.push('@Embeddable')
      parts.push(`public class ${className} {`)
      parts.push('')
      parts.push(fieldLines.join('\n'))
      parts.push('}')
      parts.push('')

      files.push({
        path: `${className}.java`,
        content: parts.join('\n'),
      })
    }

    for (const table of activeTables(schema)) {
      const allImports = new Set<string>()
      allImports.add('jakarta.persistence.*')

      const fieldLines: string[] = []
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

        const annotations: string[] = []

        // PK annotations
        if (col.isPrimaryKey) {
          annotations.push('    @Id')
          if (col.isSerial) {
            annotations.push('    @GeneratedValue(strategy = GenerationType.IDENTITY)')
          }
        }

        // Enum annotation
        if (col.category === 'enum' && col.enumValues?.length) {
          annotations.push('    @Enumerated(EnumType.STRING)')
        }

        // Composite annotation
        if (col.category === 'composite' && col.compositeFields?.length) {
          annotations.push('    @Embedded')
        }

        // FK annotations
        if (col.foreignKey) {
          annotations.push(`    @ManyToOne`)
          annotations.push(`    @JoinColumn(name = "${col.name}")`)
        }

        // Column annotations
        const colAnnotationParts: string[] = []
        if (!col.nullable && !col.isPrimaryKey) {
          colAnnotationParts.push('nullable = false')
        }
        const varcharLen = getVarcharLength(col.pgType)
        if (varcharLen) {
          colAnnotationParts.push(`length = ${varcharLen}`)
        }
        if (colAnnotationParts.length > 0) {
          annotations.push(`    @Column(${colAnnotationParts.join(', ')})`)
        }

        // Validation annotations from @validate tags
        const validation = getValidationAnnotations(col.tags)
        for (const ann of validation.annotations) {
          annotations.push(`    ${ann}`)
        }
        for (const imp of validation.imports) {
          allImports.add(imp)
        }

        if (annotations.length > 0) {
          fieldLines.push(annotations.join('\n'))
        }
        fieldLines.push(`    private ${javaType} ${col.camelName};`)
        fieldLines.push('')
      }

      const sortedImports = [...allImports].sort()
      const importLines = sortedImports.map((imp) => `import ${imp};`)

      const parts: string[] = []
      parts.push(importLines.join('\n'))
      parts.push('')
      parts.push('@Entity')
      parts.push(`@Table(name = "${table.name}")`)
      parts.push(`public class ${table.pascalName} {`)
      parts.push('')
      parts.push(fieldLines.join('\n'))
      parts.push('}')
      parts.push('')

      files.push({
        path: `${table.pascalName}.java`,
        content: parts.join('\n'),
      })
    }

    // Views (read-only — mapped as entities with a comment noting immutability)
    for (const view of schema.views.filter((v) => !v.skipped)) {
      const allImports = new Set<string>()
      allImports.add('jakarta.persistence.*')

      const fieldLines: string[] = []
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

        fieldLines.push(`    private ${javaType} ${col.camelName};`)
        fieldLines.push('')
      }

      const sortedImports = [...allImports].sort()
      const importLines = sortedImports.map((imp) => `import ${imp};`)

      const parts: string[] = []
      parts.push(importLines.join('\n'))
      parts.push('')
      parts.push('/** Read-only (from view) */')
      parts.push('@Entity')
      parts.push(`@Table(name = "${view.name}")`)
      parts.push(`public class ${view.pascalName} {`)
      parts.push('')
      parts.push(fieldLines.join('\n'))
      parts.push('}')
      parts.push('')

      files.push({
        path: `${view.pascalName}.java`,
        content: parts.join('\n'),
      })
    }

    return { files }
  },
})
