import type { AtlasRealm } from '@sqldoc/db'

/**
 * Generate a Mermaid erDiagram string from an Atlas schema realm.
 * Replaces the `{{ mermaid . }}` Atlas Go template.
 */
export function generateMermaidERD(realm: AtlasRealm): string {
  const lines: string[] = ['erDiagram']

  for (const schema of realm.schemas) {
    // Tables
    for (const table of schema.tables ?? []) {
      lines.push(`    ${escapeMermaid(table.name)} {`)

      // Determine PK and FK columns
      const pkCols = new Set<string>()
      if (table.primary_key?.parts) {
        for (const part of table.primary_key.parts) {
          if (part.column) pkCols.add(part.column)
        }
      }
      const fkCols = new Set<string>()
      for (const fk of table.foreign_keys ?? []) {
        for (const col of fk.columns ?? []) {
          fkCols.add(col)
        }
      }

      for (const col of table.columns ?? []) {
        const typeName = col.type?.raw ?? col.type?.T ?? 'unknown'
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
        const typeName = col.type?.raw ?? col.type?.T ?? 'unknown'
        lines.push(`        ${escapeMermaid(typeName)} ${escapeMermaid(col.name)}`)
      }
      lines.push('    }')
    }

    // Foreign key relationships
    for (const table of schema.tables ?? []) {
      for (const fk of table.foreign_keys ?? []) {
        if (fk.ref_table) {
          // Determine cardinality (default: many-to-one)
          lines.push(`    ${escapeMermaid(table.name)} }o--|| ${escapeMermaid(fk.ref_table)} : "${fk.symbol ?? 'fk'}"`)
        }
      }
    }
  }

  return lines.join('\n')
}

function escapeMermaid(name: string): string {
  // Mermaid entity names can't have special chars; replace quotes, spaces
  return name.replace(/"/g, '').replace(/\s+/g, '_')
}
