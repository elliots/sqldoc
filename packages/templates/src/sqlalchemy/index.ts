import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, enrichRealm } from '../helpers/enrich.ts'
import { toPascalCase, toScreamingSnake } from '../helpers/naming.ts'
import { pgToPython } from '../types/pg-to-python.ts'

/** Map PostgreSQL types to SQLAlchemy Column types */
const PG_TO_SA: Record<string, string> = {
  smallint: 'SmallInteger',
  int2: 'SmallInteger',
  integer: 'Integer',
  int: 'Integer',
  int4: 'Integer',
  bigint: 'BigInteger',
  int8: 'BigInteger',
  serial: 'Integer',
  serial4: 'Integer',
  bigserial: 'BigInteger',
  serial8: 'BigInteger',
  smallserial: 'SmallInteger',
  serial2: 'SmallInteger',
  real: 'Float',
  float4: 'Float',
  'double precision': 'Float',
  float8: 'Float',
  numeric: 'Numeric',
  decimal: 'Numeric',
  money: 'Numeric',
  text: 'Text',
  varchar: 'String',
  'character varying': 'String',
  char: 'String',
  character: 'String',
  name: 'String',
  citext: 'Text',
  boolean: 'Boolean',
  bool: 'Boolean',
  timestamp: 'DateTime',
  'timestamp without time zone': 'DateTime',
  timestamptz: 'DateTime',
  'timestamp with time zone': 'DateTime',
  date: 'Date',
  time: 'Time',
  'time without time zone': 'Time',
  timetz: 'Time',
  'time with time zone': 'Time',
  interval: 'Interval',
  bytea: 'LargeBinary',
  json: 'JSON',
  jsonb: 'JSON',
  uuid: 'String',
  inet: 'String',
  cidr: 'String',
  macaddr: 'String',
  macaddr8: 'String',
}

/** Python imports needed for specific types (used by composite dataclasses) */
const TYPE_IMPORTS: Record<string, string> = {
  datetime: 'from datetime import datetime',
  date: 'from datetime import date',
  time: 'from datetime import time',
  timedelta: 'from datetime import timedelta',
  Decimal: 'from decimal import Decimal',
  UUID: 'from uuid import UUID',
  Any: 'from typing import Any',
}

/** Attribute names reserved by SQLAlchemy's declarative base */
const SA_RESERVED = new Set(['metadata', 'registry', 'query', 'query_class'])

export default defineTemplate({
  name: 'SQLAlchemy Models',
  description: 'Generate SQLAlchemy ORM model classes with Column definitions from SQL schema',
  language: 'python',

  generate(ctx) {
    const schema = enrichRealm(ctx)
    const saTypes = new Set<string>()
    const needsForeignKey = { value: false }
    const needsARRAY = { value: false }
    const needsEnum = { value: false }
    const needsDataclass = { value: false }
    const extraImports = new Set<string>()
    const modelBlocks: string[] = []
    const enumBlocks: string[] = []
    const compositeBlocks: string[] = []

    // Enums
    for (const e of schema.enums) {
      needsEnum.value = true
      const className = toPascalCase(e.name)
      const members = e.values.map((v) => `    ${toScreamingSnake(v)} = "${v}"`).join('\n')
      enumBlocks.push(`class ${className}(str, enum.Enum):\n${members}`)
    }

    // Composite types (collected from columns, rendered as dataclasses)
    const composites = new Map<string, Array<{ name: string; type: string }>>()
    for (const table of schema.tables) {
      for (const col of table.columns) {
        if (col.category === 'composite' && col.compositeFields?.length && !composites.has(col.pgType)) {
          composites.set(col.pgType, col.compositeFields)
        }
      }
    }
    for (const [name, fields] of composites) {
      needsDataclass.value = true
      const typeName = toPascalCase(name)
      const fieldLines: string[] = []
      for (const f of fields) {
        const pyType = pgToPython(f.type, false)
        collectTypeImports(pyType, extraImports)
        fieldLines.push(`    ${f.name}: ${pyType}`)
      }
      compositeBlocks.push(`@dataclass\nclass ${typeName}:\n${fieldLines.join('\n')}`)
    }

    // Build lookup of tables that have an explicit schema set (non-default schema)
    // so FK references can be schema-qualified only when needed
    const tablesWithSchema = new Set(
      schema.tables.filter((t) => t.sqlName !== t.name).map((t) => `${t.schema}.${t.name}`),
    )

    for (const table of activeTables(schema)) {
      const lines: string[] = []
      lines.push(`class ${table.pascalName}(Base):`)
      lines.push(`    __tablename__ = '${table.name}'`)
      if (table.sqlName !== table.name) {
        lines.push(`    __table_args__ = {'schema': '${table.schema}'}`)
      }
      lines.push('')

      for (const col of table.columns) {
        let saType: string

        if (col.typeOverride) {
          saType = col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          saType = `Enum(${toPascalCase(col.pgType)})`
          saTypes.add('Enum')
        } else {
          saType = mapToSAType(col.pgType, saTypes, needsARRAY)
        }

        const columnArgs: string[] = [saType]

        // Foreign key -- schema-qualify only when the target table has an explicit
        // schema in __table_args__, so SQLAlchemy can resolve cross-schema references
        if (col.foreignKey) {
          const fkTargetKey = `${col.foreignKey.schema}.${col.foreignKey.table}`
          const fkRef = tablesWithSchema.has(fkTargetKey)
            ? `${col.foreignKey.schema}.${col.foreignKey.table}.${col.foreignKey.column}`
            : `${col.foreignKey.table}.${col.foreignKey.column}`
          columnArgs.push(`ForeignKey('${fkRef}')`)
          needsForeignKey.value = true
        }

        // Column kwargs
        const kwargs: string[] = []
        if (col.isPrimaryKey) kwargs.push('primary_key=True')
        if (!col.nullable && !col.isPrimaryKey) kwargs.push('nullable=False')

        const allArgs = [...columnArgs, ...kwargs].join(', ')
        const attr = SA_RESERVED.has(col.name) ? `${col.name}_` : col.name
        const colName = attr !== col.name ? `'${col.name}', ` : ''
        lines.push(`    ${attr} = Column(${colName}${allArgs})`)
      }

      modelBlocks.push(lines.join('\n'))
    }

    // Views (read-only, plain Table objects — no ORM PK requirement)
    const needsTable = { value: false }
    const viewBlocks: string[] = []
    for (const view of schema.views.filter((v) => !v.skipped && v.columns.length > 0)) {
      needsTable.value = true
      const colDefs: string[] = []
      for (const col of view.columns) {
        let saType: string
        if (col.typeOverride) {
          saType = col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          saType = `Enum(${toPascalCase(col.pgType)})`
          saTypes.add('Enum')
        } else {
          saType = mapToSAType(col.pgType, saTypes, needsARRAY)
        }
        colDefs.push(`    Column('${col.name}', ${saType}),`)
      }
      const schemaArg = view.sqlName !== view.name ? `\n    schema='${view.schema}',` : ''
      viewBlocks.push(
        `${view.name} = Table(\n    '${view.name}',\n    Base.metadata,${schemaArg}\n${colDefs.join('\n')}\n)`,
      )
    }

    // Collect needed SA type imports
    const saImportTypes = ['Column', ...saTypes].sort((a, b) => a.localeCompare(b))
    if (needsForeignKey.value) saImportTypes.push('ForeignKey')
    if (needsARRAY.value) saImportTypes.push('ARRAY')
    if (needsTable.value) saImportTypes.push('Table')

    const importLines: string[] = [
      `from sqlalchemy import ${saImportTypes.join(', ')}`,
      'from sqlalchemy.orm import declarative_base',
    ]
    if (needsDataclass.value) {
      importLines.push('from dataclasses import dataclass')
    }
    if (needsEnum.value) {
      importLines.push('import enum')
    }
    for (const imp of [...extraImports].sort((a, b) => a.localeCompare(b))) {
      importLines.push(imp)
    }

    const preModelBlocks = [...enumBlocks, ...compositeBlocks]

    const content = `# Generated by @sqldoc/templates/sqlalchemy -- DO NOT EDIT

${importLines.join('\n')}

Base = declarative_base()

${preModelBlocks.length > 0 ? `\n${preModelBlocks.join('\n\n\n')}\n\n` : ''}
${modelBlocks.join('\n\n\n')}
${viewBlocks.length > 0 ? `\n\n# Views\n${viewBlocks.join('\n\n\n')}\n` : ''}
`

    return {
      files: [{ path: 'models.py', content }],
    }
  },
})

function collectTypeImports(pyType: string, imports: Set<string>): void {
  const match = pyType.match(/^Optional\[(.+)\]$/)
  const baseType = match ? match[1] : pyType
  const listMatch = baseType.match(/^list\[(.+)\]$/)
  const innerType = listMatch ? listMatch[1] : baseType

  if (TYPE_IMPORTS[innerType]) {
    imports.add(TYPE_IMPORTS[innerType])
  }
}

function mapToSAType(pgType: string, saTypes: Set<string>, needsARRAY: { value: boolean }): string {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays
  if (normalized.endsWith('[]') || normalized.startsWith('_')) {
    const base = normalized.endsWith('[]') ? normalized.slice(0, -2) : normalized.slice(1)
    const innerType = mapToSAType(base, saTypes, needsARRAY)
    needsARRAY.value = true
    return `ARRAY(${innerType})`
  }

  // Handle varchar(n)
  const lengthMatch = normalized.match(/^(?:varchar|character varying|char|character)\((\d+)\)$/)
  if (lengthMatch) {
    saTypes.add('String')
    return `String(${lengthMatch[1]})`
  }

  // Handle numeric(p,s)
  const numericMatch = normalized.match(/^(?:numeric|decimal)\((\d+),\s*(\d+)\)$/)
  if (numericMatch) {
    saTypes.add('Numeric')
    return `Numeric(${numericMatch[1]}, ${numericMatch[2]})`
  }

  // Strip remaining length specifiers for lookup
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()
  const saType = PG_TO_SA[baseType] ?? 'String'
  saTypes.add(saType)
  return saType
}
