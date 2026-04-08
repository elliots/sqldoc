import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, type EnrichedTable, enrichRealm } from '../helpers/enrich.ts'
import { toPascalCase } from '../helpers/naming.ts'

export const configSchema = {
  provider: {
    type: 'string',
    description: 'Database provider (default: postgresql)',
  },
} as const

/** Map a PostgreSQL type to a Prisma type */
function pgToPrisma(pgType: string): string {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays
  if (normalized.endsWith('[]')) {
    return `${pgToPrisma(normalized.slice(0, -2))}[]`
  }
  if (normalized.startsWith('_')) {
    return `${pgToPrisma(normalized.slice(1))}[]`
  }

  // Strip length specifiers
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  const map: Record<string, string> = {
    // Numeric
    smallint: 'Int',
    int2: 'Int',
    integer: 'Int',
    int: 'Int',
    int4: 'Int',
    bigint: 'BigInt',
    int8: 'BigInt',
    serial: 'Int',
    serial4: 'Int',
    bigserial: 'BigInt',
    serial8: 'BigInt',
    smallserial: 'Int',
    serial2: 'Int',
    real: 'Float',
    float4: 'Float',
    'double precision': 'Float',
    float8: 'Float',
    numeric: 'Decimal',
    decimal: 'Decimal',
    money: 'String',

    // String
    text: 'String',
    varchar: 'String',
    'character varying': 'String',
    char: 'String',
    character: 'String',
    name: 'String',
    citext: 'String',

    // Boolean
    boolean: 'Boolean',
    bool: 'Boolean',

    // Date/Time
    timestamp: 'DateTime',
    'timestamp without time zone': 'DateTime',
    timestamptz: 'DateTime',
    'timestamp with time zone': 'DateTime',
    date: 'DateTime',
    time: 'String',
    'time without time zone': 'String',
    timetz: 'String',
    'time with time zone': 'String',
    interval: 'String',

    // Binary
    bytea: 'Bytes',

    // JSON
    json: 'Json',
    jsonb: 'Json',

    // UUID
    uuid: 'String',

    // Network
    inet: 'String',
    cidr: 'String',
    macaddr: 'String',
    macaddr8: 'String',

    // Other
    xml: 'String',
    tsvector: 'String',
    tsquery: 'String',
    oid: 'Int',
    point: 'String',
    line: 'String',
    box: 'String',
    circle: 'String',
    polygon: 'String',
    path: 'String',
  }

  return map[baseType] ?? 'String'
}

/** Check if column has a unique index */
function isUnique(table: EnrichedTable, colName: string): boolean {
  return (
    table.raw.indexes?.some(
      (idx) => idx.unique === true && idx.parts?.length === 1 && idx.parts[0].column === colName,
    ) ?? false
  )
}

/** Format a Prisma default expression */
function formatPrismaDefault(defaultValue: string | undefined, isSerial: boolean): string | undefined {
  if (isSerial) return '@default(autoincrement())'
  if (!defaultValue) return undefined

  if (defaultValue === 'now()' || defaultValue === 'CURRENT_TIMESTAMP') return '@default(now())'
  if (defaultValue === 'gen_random_uuid()') return '@default(uuid())'
  if (defaultValue === 'true' || defaultValue === 'false') return `@default(${defaultValue})`
  if (/^\d+$/.test(defaultValue)) return `@default(${defaultValue})`

  // Check if it looks like an expression (has parens)
  if (defaultValue.includes('(')) return `@default(dbgenerated("${defaultValue}"))`

  return `@default("${defaultValue}")`
}

export default defineTemplate({
  name: 'Prisma Schema',
  description: 'Generate Prisma schema models from SQL schema',
  language: 'sql',
  configSchema,

  generate(ctx) {
    const schema = enrichRealm(ctx)
    const tables = activeTables(schema)

    // Build model name map for relations -- keyed by schema-qualified name for multi-schema uniqueness
    const modelNameMap = new Map<string, string>()
    for (const table of tables) {
      modelNameMap.set(`${table.schema}.${table.name}`, table.pascalName)
      // Also set unqualified for backward compat / single-schema fallback
      if (!modelNameMap.has(table.name)) {
        modelNameMap.set(table.name, table.pascalName)
      }
    }

    /** Resolve a model name from FK target. Try schema-qualified first, then unqualified fallback. */
    function resolveModelName(foreignSchema: string, foreignTable: string): string {
      return (
        modelNameMap.get(`${foreignSchema}.${foreignTable}`) ??
        modelNameMap.get(foreignTable) ??
        toPascalCase(foreignTable)
      )
    }

    const provider = (ctx.config as any)?.provider ?? 'postgresql'

    // ── Multi-schema detection ──────────────────────────────────────
    const allSchemas = new Set<string>()
    for (const table of tables) allSchemas.add(table.schema)
    for (const view of schema.views.filter((v) => !v.skipped && v.columns.length > 0)) allSchemas.add(view.schema)
    const isMultiSchema = allSchemas.size > 1

    // Pre-compute: count how many FK relations target each model, to decide if we need named relations
    // Also track reverse relations that need to be added to target models
    // Keys use schema-qualified names for uniqueness
    const reverseRelations = new Map<string, Array<{ fromTable: string; relName: string; needsName: boolean }>>()
    // Count per-model how many FKs point to the same target, keyed by schema-qualified source
    const fkCountByTarget = new Map<string, Map<string, number>>()

    for (const table of tables) {
      if (table.belongsTo.length > 0) {
        const qualifiedName = `${table.schema}.${table.name}`
        const targetCounts = new Map<string, number>()
        for (const rel of table.belongsTo) {
          const qualifiedTarget = `${rel.foreignSchema}.${rel.foreignTable}`
          targetCounts.set(qualifiedTarget, (targetCounts.get(qualifiedTarget) ?? 0) + 1)
        }
        fkCountByTarget.set(qualifiedName, targetCounts)
      }
    }

    // Determine which relations need explicit names
    interface FkRelation {
      column: string
      refTable: string
      refColumn: string
      refSchema: string
      constraintName: string
      relName: string
      relationName: string | undefined
    }

    const tableRelations = new Map<string, FkRelation[]>()

    for (const table of tables) {
      if (table.belongsTo.length === 0) continue

      const qualifiedName = `${table.schema}.${table.name}`
      const targetCounts = fkCountByTarget.get(qualifiedName) ?? new Map()
      const relations: FkRelation[] = []

      for (const rel of table.belongsTo) {
        const relName = rel.column.replace(/_id$/, '')
        const qualifiedTarget = `${rel.foreignSchema}.${rel.foreignTable}`
        // Need explicit relation name for self-relations or multiple FKs to the same target
        const isSelfRelation = rel.foreignTable === table.name && rel.foreignSchema === table.schema
        const needsRelationName = isSelfRelation || (targetCounts.get(qualifiedTarget) ?? 0) > 1
        const relationName = needsRelationName ? rel.constraintName || `${table.name}_${rel.column}` : undefined

        relations.push({
          column: rel.column,
          refTable: rel.foreignTable,
          refColumn: rel.foreignColumn,
          refSchema: rel.foreignSchema,
          constraintName: rel.constraintName,
          relName,
          relationName,
        })

        // Track reverse relation using schema-qualified target key
        if (!reverseRelations.has(qualifiedTarget)) {
          reverseRelations.set(qualifiedTarget, [])
        }
        reverseRelations.get(qualifiedTarget)!.push({
          fromTable: `${table.schema}.${table.name}`,
          relName: needsRelationName ? relName : resolveModelName(table.schema, table.name),
          needsName: needsRelationName,
        })
      }

      tableRelations.set(qualifiedName, relations)
    }

    const blocks: string[] = [
      '// Generated by @sqldoc/templates/prisma -- DO NOT EDIT',
      '',
      `datasource db {`,
      `  provider = "${provider}"`,
      `  url      = env("DATABASE_URL")`,
    ]
    if (isMultiSchema) {
      const sortedSchemas = [...allSchemas].sort((a, b) => a.localeCompare(b))
      blocks.push(`  schemas  = [${sortedSchemas.map((s) => `"${s}"`).join(', ')}]`)
    }
    blocks.push(`}`, '')

    blocks.push(`generator client {`)
    blocks.push(`  provider = "prisma-client-js"`)
    if (isMultiSchema) {
      blocks.push(`  previewFeatures = ["multiSchema"]`)
    }
    blocks.push(`}`, '')

    // Enums
    for (const e of schema.enums) {
      blocks.push(`enum ${e.pascalName} {`)
      for (const val of e.values) {
        blocks.push(`  ${val}`)
      }
      blocks.push('}')
      blocks.push('')
    }

    for (const table of tables) {
      const modelName = table.pascalName
      const fieldLines: string[] = []

      // Detect composite primary key (more than one PK column)
      const pkCols = table.columns.filter((c: any) => c.isPrimaryKey)
      const isCompositePk = pkCols.length > 1

      for (const col of table.columns) {
        let prismaType: string
        if (col.typeOverride) {
          prismaType = col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          prismaType = toPascalCase(col.pgType)
        } else if (col.category === 'composite') {
          prismaType = `Unsupported("${col.pgType}")`
        } else {
          prismaType = pgToPrisma(col.pgType)
        }

        if (col.nullable && !prismaType.startsWith('Unsupported') && !prismaType.endsWith('[]')) {
          prismaType += '?'
        }

        const attrs: string[] = []

        // For composite PKs, use @@id at the model level instead of @id on each column
        if (col.isPrimaryKey && !isCompositePk) {
          attrs.push('@id')
        }

        const defaultAttr = formatPrismaDefault(col.defaultValue, col.isSerial)
        if (defaultAttr) {
          attrs.push(defaultAttr)
        } else if (col.isSerial) {
          attrs.push('@default(autoincrement())')
        }

        if (isUnique(table, col.name)) {
          attrs.push('@unique')
        }

        // Map column name to Prisma field name + @map
        const fieldName = col.name
        const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
        fieldLines.push(`  ${fieldName} ${prismaType}${attrStr}`)
      }

      // Add relation fields for foreign keys on this table
      const qualifiedName = `${table.schema}.${table.name}`
      const relations = tableRelations.get(qualifiedName) ?? []
      for (const rel of relations) {
        const refModelName = resolveModelName(rel.refSchema, rel.refTable)
        const relNameAttr = rel.relationName ? `, name: "${rel.relationName}"` : ''
        // If the FK column is nullable, the relation field must also be optional
        const fkCol = table.columns.find((c: any) => c.name === rel.column)
        const optionalMark = fkCol?.nullable ? '?' : ''
        fieldLines.push(
          `  ${rel.relName} ${refModelName}${optionalMark} @relation(fields: [${rel.column}], references: [${rel.refColumn}]${relNameAttr})`,
        )
      }

      // Add reverse relation fields (other models that reference this one)
      const reverseRels = reverseRelations.get(qualifiedName) ?? []
      // Group by source table to handle naming
      const reverseBySource = new Map<string, typeof reverseRels>()
      for (const rev of reverseRels) {
        if (!reverseBySource.has(rev.fromTable)) {
          reverseBySource.set(rev.fromTable, [])
        }
        reverseBySource.get(rev.fromTable)!.push(rev)
      }

      for (const [sourceQualified, rels] of reverseBySource) {
        // sourceQualified is "schema.table" format
        const [sourceSchema, sourceTable] = sourceQualified.includes('.')
          ? [sourceQualified.split('.')[0], sourceQualified.split('.').slice(1).join('.')]
          : ['', sourceQualified]
        const sourceModelName = resolveModelName(sourceSchema, sourceTable)
        if (rels.length === 1 && !rels[0].needsName) {
          // Simple reverse: just add ModelName[]
          const fieldName = sourceTable
          fieldLines.push(`  ${fieldName} ${sourceModelName}[]`)
        } else {
          // Multiple relations from same source: need named relations
          for (const rel of rels) {
            const sourceRelations = tableRelations.get(sourceQualified) ?? []
            const matchingRel = sourceRelations.find((r) => r.relName === rel.relName)
            const relationName = matchingRel?.relationName
            const relNameAttr = relationName ? `(name: "${relationName}")` : ''
            const fieldName = `${rel.relName}_${sourceTable}`
            fieldLines.push(`  ${fieldName} ${sourceModelName}[] @relation${relNameAttr}`)
          }
        }
      }

      // Add @@id for composite primary keys
      if (isCompositePk) {
        fieldLines.push('')
        fieldLines.push(`  @@id([${pkCols.map((c: any) => c.name).join(', ')}])`)
      }

      // Add @@map when the Prisma model name differs from the SQL table name
      if (table.pascalName !== table.name) {
        fieldLines.push('')
        fieldLines.push(`  @@map("${table.name}")`)
      }

      // Add @@schema for all tables when multi-schema is active (Prisma requires it on every model)
      if (isMultiSchema) {
        if (table.sqlName === table.name) fieldLines.push('')
        fieldLines.push(`  @@schema("${table.schema}")`)
      }

      blocks.push(`model ${modelName} {`)
      blocks.push(fieldLines.join('\n'))
      blocks.push('}')
      blocks.push('')
    }

    // Views (read-only — represented as Prisma models with @@map)
    for (const view of schema.views.filter((v) => !v.skipped && v.columns.length > 0)) {
      const fieldLines: string[] = []

      // Views need a dummy @id — use the first column as a stand-in
      const firstCol = view.columns[0]

      for (const col of view.columns) {
        let prismaType: string
        if (col.typeOverride) {
          prismaType = col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          prismaType = toPascalCase(col.pgType)
        } else {
          prismaType = pgToPrisma(col.pgType)
        }

        const isIdCol = col.name === firstCol?.name

        // Prisma requires @id fields to be non-nullable, so skip '?' for the dummy @id column on views
        if (col.nullable && !prismaType.endsWith('[]') && !isIdCol) {
          prismaType += '?'
        }

        const attrs: string[] = []
        if (isIdCol) {
          attrs.push('@id')
        }
        const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
        fieldLines.push(`  ${col.name} ${prismaType}${attrStr}`)
      }

      fieldLines.push('')
      fieldLines.push(`  @@map("${view.name}")`)

      // Add @@schema for all views when multi-schema is active (Prisma requires it on every model)
      if (isMultiSchema) {
        fieldLines.push(`  @@schema("${view.schema}")`)
      }

      blocks.push(`/// Read-only (from view)`)
      blocks.push(`model ${view.pascalName} {`)
      blocks.push(fieldLines.join('\n'))
      blocks.push('}')
      blocks.push('')
    }

    return {
      files: [
        {
          path: 'schema.prisma',
          content: blocks.join('\n'),
        },
      ],
    }
  },
})
