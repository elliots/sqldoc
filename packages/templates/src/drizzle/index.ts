import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, enrichRealm } from '../helpers/enrich.ts'
import { toCamelCase } from '../helpers/naming.ts'

export const configSchema = {
  schemaName: {
    type: 'string',
    description: 'PostgreSQL schema name override',
  },
} as const

/** Track which drizzle-orm/pg-core imports are used */
interface ImportTracker {
  used: Set<string>
}

/** Map a PostgreSQL type to a Drizzle column builder call */
function pgToDrizzle(pgType: string, colName: string, tracker: ImportTracker): string {
  const normalized = pgType.toLowerCase().trim()

  // Strip length specifiers for lookup
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  const map: Record<string, [string, string]> = {
    // [drizzle-function-name, import-name]
    smallint: ['smallint', 'smallint'],
    int2: ['smallint', 'smallint'],
    integer: ['integer', 'integer'],
    int: ['integer', 'integer'],
    int4: ['integer', 'integer'],
    bigint: ['bigint', 'bigint'],
    int8: ['bigint', 'bigint'],
    serial: ['serial', 'serial'],
    serial4: ['serial', 'serial'],
    bigserial: ['bigserial', 'bigserial'],
    serial8: ['bigserial', 'bigserial'],
    smallserial: ['smallserial', 'smallserial'],
    serial2: ['smallserial', 'smallserial'],
    real: ['real', 'real'],
    float4: ['real', 'real'],
    'double precision': ['doublePrecision', 'doublePrecision'],
    float8: ['doublePrecision', 'doublePrecision'],
    numeric: ['numeric', 'numeric'],
    decimal: ['numeric', 'numeric'],
    money: ['text', 'text'],

    text: ['text', 'text'],
    varchar: ['varchar', 'varchar'],
    'character varying': ['varchar', 'varchar'],
    char: ['char', 'char'],
    character: ['char', 'char'],
    name: ['text', 'text'],
    citext: ['text', 'text'],

    boolean: ['boolean', 'boolean'],
    bool: ['boolean', 'boolean'],

    timestamp: ['timestamp', 'timestamp'],
    'timestamp without time zone': ['timestamp', 'timestamp'],
    timestamptz: ['timestamp', 'timestamp'],
    'timestamp with time zone': ['timestamp', 'timestamp'],
    date: ['date', 'date'],
    time: ['time', 'time'],
    'time without time zone': ['time', 'time'],
    timetz: ['time', 'time'],
    'time with time zone': ['time', 'time'],
    interval: ['interval', 'interval'],

    bytea: ['text', 'text'],

    json: ['json', 'json'],
    jsonb: ['jsonb', 'jsonb'],

    uuid: ['uuid', 'uuid'],

    inet: ['inet', 'inet'],
    cidr: ['text', 'text'],
    macaddr: ['macaddr', 'macaddr'],
    macaddr8: ['macaddr8', 'macaddr8'],

    xml: ['text', 'text'],
    tsvector: ['text', 'text'],
    tsquery: ['text', 'text'],
    oid: ['integer', 'integer'],
    point: ['text', 'text'],
    line: ['text', 'text'],
    box: ['text', 'text'],
    circle: ['text', 'text'],
    polygon: ['text', 'text'],
    path: ['text', 'text'],
  }

  const entry = map[baseType]
  if (entry) {
    tracker.used.add(entry[1])
    // bigint and bigserial require a mode option in drizzle-orm 0.38+
    if (entry[0] === 'bigint' || entry[0] === 'bigserial') {
      return `${entry[0]}('${colName}', { mode: 'number' })`
    }
    return `${entry[0]}('${colName}')`
  }

  // Fallback: arrays and unknowns
  if (normalized.endsWith('[]') || normalized.startsWith('_')) {
    tracker.used.add('text')
    return `text('${colName}')`
  }

  tracker.used.add('text')
  return `text('${colName}')`
}

/** Format a default expression for Drizzle */
function formatDefault(defaultValue: string | undefined): string | undefined {
  if (!defaultValue) return undefined
  // Heuristic: expressions with parens or uppercase keywords are likely SQL expressions
  if (defaultValue.includes('(') || /^[A-Z_]+$/.test(defaultValue)) {
    return `sql\`${defaultValue}\``
  }
  if (defaultValue === 'true' || defaultValue === 'false') return defaultValue
  if (/^-?\d+(\.\d+)?$/.test(defaultValue)) return defaultValue
  return `'${defaultValue}'`
}

export default defineTemplate({
  name: 'Drizzle Schema',
  description: 'Generate Drizzle ORM pgTable schema definitions from SQL schema',
  language: 'typescript',
  configSchema,

  generate(ctx) {
    const schema = enrichRealm(ctx)
    const tables = activeTables(schema)
    const tracker: ImportTracker = { used: new Set() }
    const tableBlocks: string[] = []

    // Detect which non-default schemas are used (need pgSchema declarations)
    const defaultSchema = ctx.defaultSchema ?? 'public'
    const nonDefaultSchemas = new Set<string>()
    for (const table of tables) {
      if (table.schema !== defaultSchema) nonDefaultSchemas.add(table.schema)
    }
    for (const view of schema.views.filter((v) => !v.skipped)) {
      if (view.schema !== defaultSchema) nonDefaultSchemas.add(view.schema)
    }
    if (nonDefaultSchemas.size > 0) tracker.used.add('pgSchema')

    // We'll need a map from table name to camelCase variable name for FK references
    // Key by schema-qualified name for uniqueness in multi-schema realms
    const tableVarMap = new Map<string, string>()
    for (const table of tables) {
      tableVarMap.set(`${table.schema}.${table.name}`, toCamelCase(table.pascalName))
      // Also set unqualified name for backward compat / single-schema fallback
      if (!tableVarMap.has(table.name)) {
        tableVarMap.set(table.name, toCamelCase(table.pascalName))
      }
    }

    // Enums
    const enumBlocks: string[] = []
    if (schema.enums.length > 0) {
      tracker.used.add('pgEnum')
      for (const e of schema.enums) {
        const values = e.values.map((v) => `'${v}'`).join(', ')
        enumBlocks.push(`export const ${toCamelCase(e.name)}Enum = pgEnum('${e.name}', [${values}])`)
      }
    }

    for (const table of tables) {
      const varName = toCamelCase(table.pascalName)

      const colLines: string[] = []

      for (const col of table.columns) {
        let builder: string
        if (col.typeOverride) {
          tracker.used.add('text')
          builder = `text('${col.name}')`
        } else if (col.category === 'enum' && col.enumValues?.length) {
          builder = `${toCamelCase(col.pgType)}Enum('${col.name}')`
        } else {
          builder = pgToDrizzle(col.pgType, col.name, tracker)
        }

        // Add modifiers
        if (col.isPrimaryKey) {
          builder += '.primaryKey()'
        }
        if (!col.nullable && !col.isSerial) {
          builder += '.notNull()'
        }

        const defaultExpr = formatDefault(col.defaultValue)
        if (defaultExpr) {
          if (defaultExpr.startsWith('sql`')) {
            tracker.used.add('sql')
            builder += `.default(${defaultExpr})`
          } else {
            builder += `.default(${defaultExpr})`
          }
        }

        // Foreign key references (skip self-references to avoid circular implicit-any in TS)
        if (col.foreignKey && !(col.foreignKey.table === table.name && col.foreignKey.schema === table.schema)) {
          const qualifiedKey = `${col.foreignKey.schema}.${col.foreignKey.table}`
          const refVar =
            tableVarMap.get(qualifiedKey) ?? tableVarMap.get(col.foreignKey.table) ?? toCamelCase(col.foreignKey.table)
          const refCol = col.foreignKey.column
          builder += `.references(() => ${refVar}.${toCamelCase(refCol)})`
        }

        colLines.push(`  ${toCamelCase(col.name)}: ${builder},`)
      }

      // Use pgSchema().table() for non-default schemas, pgTable() for default schema
      if (table.schema !== defaultSchema) {
        const schemaVar = `${toCamelCase(table.schema)}Schema`
        tableBlocks.push(`export const ${varName} = ${schemaVar}.table('${table.name}', {\n${colLines.join('\n')}\n})`)
      } else {
        tracker.used.add('pgTable')
        tableBlocks.push(`export const ${varName} = pgTable('${table.name}', {\n${colLines.join('\n')}\n})`)
      }
    }

    // Views (read-only)
    for (const view of schema.views.filter((v) => !v.skipped)) {
      const varName = toCamelCase(view.pascalName)

      const colLines: string[] = []
      for (const col of view.columns) {
        let builder: string
        if (col.typeOverride) {
          tracker.used.add('text')
          builder = `text('${col.name}')`
        } else if (col.category === 'enum' && col.enumValues?.length) {
          builder = `${toCamelCase(col.pgType)}Enum('${col.name}')`
        } else {
          builder = pgToDrizzle(col.pgType, col.name, tracker)
        }

        colLines.push(`  ${toCamelCase(col.name)}: ${builder},`)
      }

      // Use pgSchema().view() for non-default schemas, pgView() for default schema
      if (view.schema !== defaultSchema) {
        const schemaVar = `${toCamelCase(view.schema)}Schema`
        tableBlocks.push(
          `/** Read-only (from view) */\nexport const ${varName} = ${schemaVar}.view('${view.name}', {\n${colLines.join('\n')}\n})`,
        )
      } else {
        tracker.used.add('pgView')
        tableBlocks.push(
          `/** Read-only (from view) */\nexport const ${varName} = pgView('${view.name}', {\n${colLines.join('\n')}\n})`,
        )
      }
    }

    // Build imports
    const importNames = Array.from(tracker.used).sort((a, b) => a.localeCompare(b))
    const sqlImport = importNames.includes('sql')
    const pgCoreImports = importNames.filter((n) => n !== 'sql')

    const lines: string[] = [
      '// Generated by @sqldoc/templates/drizzle -- DO NOT EDIT',
      '',
      `import { ${pgCoreImports.join(', ')} } from 'drizzle-orm/pg-core'`,
    ]
    if (sqlImport) {
      lines.push("import { sql } from 'drizzle-orm'")
    }
    lines.push('')

    // Emit pgSchema declarations for non-default schemas
    if (nonDefaultSchemas.size > 0) {
      const sortedSchemas = [...nonDefaultSchemas].sort((a, b) => a.localeCompare(b))
      for (const s of sortedSchemas) {
        lines.push(`export const ${toCamelCase(s)}Schema = pgSchema('${s}')`)
      }
      lines.push('')
    }

    if (enumBlocks.length > 0) {
      lines.push(enumBlocks.join('\n'))
      lines.push('')
    }
    lines.push(tableBlocks.join('\n\n'))
    lines.push('')

    return {
      files: [
        {
          path: 'schema.ts',
          content: lines.join('\n'),
        },
      ],
    }
  },
})
