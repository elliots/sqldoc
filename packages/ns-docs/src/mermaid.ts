import type { Realm } from '@sqldoc/core'

/**
 * Generate a Mermaid erDiagram string from a schema realm.
 */
export function generateMermaidERD(realm: Realm): string {
  const lines: string[] = ['erDiagram']

  for (const schema of realm.schemas) {
    // Tables
    for (const table of schema.tables ?? []) {
      lines.push(`    ${escapeMermaid(table.name)} {`)

      // Determine PK and FK columns
      const pkCols = new Set<string>()
      if (table.primaryKey?.parts) {
        for (const part of table.primaryKey.parts) {
          if (part.column) pkCols.add(part.column)
        }
      }
      const fkCols = new Set<string>()
      for (const fk of table.foreignKeys ?? []) {
        for (const col of fk.columns) {
          fkCols.add(col)
        }
      }

      for (const col of table.columns) {
        const typeName = col.type.raw ?? col.type.type.T ?? 'unknown'
        const constraints: string[] = []
        if (pkCols.has(col.name)) constraints.push('PK')
        if (fkCols.has(col.name)) constraints.push('FK')
        const constraintStr = constraints.length > 0 ? ` ${constraints.join(',')}` : ''
        lines.push(`        ${escapeMermaid(typeName)} ${escapeMermaid(col.name)}${constraintStr}`)
      }
      lines.push('    }')
    }

    // Views (entity name with columns)
    for (const view of schema.views ?? []) {
      lines.push(`    ${escapeMermaid(view.name)} {`)
      for (const col of view.columns ?? []) {
        const typeName = col.type.raw ?? col.type.type.T ?? 'unknown'
        lines.push(`        ${escapeMermaid(typeName)} ${escapeMermaid(col.name)}`)
      }
      lines.push('    }')
    }

    // Foreign key relationships
    for (const table of schema.tables ?? []) {
      for (const fk of table.foreignKeys ?? []) {
        // Determine cardinality (default: many-to-one)
        lines.push(`    ${escapeMermaid(table.name)} }o--|| ${escapeMermaid(fk.refTable)} : "${fk.symbol ?? 'fk'}"`)
      }
    }
  }

  return lines.join('\n')
}

function escapeMermaid(name: string): string {
  // Mermaid entity names can't have special chars; replace quotes, spaces
  return name.replace(/"/g, '').replace(/\s+/g, '_')
}
