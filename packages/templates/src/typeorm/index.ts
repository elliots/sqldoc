import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, type EnrichedTable, enrichRealm } from '../helpers/enrich.ts'
import { singularizeLast, toCamelCase, toPascalCase } from '../helpers/naming.ts'
import { pgToTs } from '../types/pg-to-ts.ts'

/** Map pgType to TypeORM column type string and detect array types */
function pgTypeToTypeOrmType(pgType: string, category: string): { type: string; array?: boolean } {
  const normalized = pgType.toLowerCase().trim()

  // Handle array types: "text[]", "integer[]", etc.
  if (category === 'array' || normalized.endsWith('[]')) {
    const baseType = normalized.replace(/\[\]$/, '')
    const mapped = pgTypeToTypeOrmType(baseType, 'scalar')
    return { type: mapped.type, array: true }
  }

  // Composite types (user-defined structs) are not natively supported by TypeORM.
  // Store as jsonb so TypeORM can persist and retrieve them.
  if (category === 'composite') {
    return { type: 'jsonb' }
  }

  // Strip length/precision qualifiers for matching
  const base = normalized.replace(/\(.*\)/, '').trim()
  const map: Record<string, string> = {
    bigint: 'bigint',
    int8: 'bigint',
    bigserial: 'bigint',
    serial8: 'bigint',
    integer: 'int',
    int: 'int',
    int4: 'int',
    serial: 'int',
    serial4: 'int',
    smallint: 'int2',
    int2: 'int2',
    smallserial: 'int2',
    serial2: 'int2',
    boolean: 'boolean',
    bool: 'boolean',
    text: 'text',
    'character varying': 'varchar',
    varchar: 'varchar',
    character: 'char',
    char: 'char',
    uuid: 'uuid',
    json: 'json',
    jsonb: 'jsonb',
    bytea: 'bytea',
    date: 'date',
    'timestamp without time zone': 'timestamp',
    timestamp: 'timestamp',
    'timestamp with time zone': 'timestamptz',
    timestamptz: 'timestamptz',
    'time without time zone': 'time',
    time: 'time',
    'time with time zone': 'timetz',
    timetz: 'timetz',
    interval: 'interval',
    real: 'float4',
    float4: 'float4',
    'double precision': 'float8',
    float8: 'float8',
    numeric: 'decimal',
    decimal: 'decimal',
    money: 'money',
    inet: 'inet',
    cidr: 'cidr',
    macaddr: 'macaddr',
    xml: 'xml',
    point: 'point',
    line: 'line',
    circle: 'circle',
    box: 'box',
    path: 'path',
    polygon: 'polygon',
    bit: 'bit',
    'bit varying': 'varbit',
    varbit: 'varbit',
    tsvector: 'tsvector',
    tsquery: 'tsquery',
  }
  return { type: map[base] ?? base }
}

/** Map pgType to TypeScript type for the entity property */
function pgTypeToTsType(pgType: string, nullable: boolean, category: string): string {
  const normalized = pgType.toLowerCase().trim()
  // BigInt types map to string in TypeORM (JavaScript can't represent bigint safely)
  if (['bigint', 'int8', 'bigserial', 'serial8'].includes(normalized)) {
    return nullable ? 'string | null' : 'string'
  }
  // Decimal maps to string
  if (['numeric', 'decimal', 'money'].includes(normalized.replace(/\(.*\)/, '').trim())) {
    return nullable ? 'string | null' : 'string'
  }
  return pgToTs(pgType, nullable, { nullableStyle: 'null-union' }, category as any)
}

/** Convert table name to entity file name: "post_tags" -> "post-tags.entity.ts" */
function toEntityFileName(name: string): string {
  return `${name.replaceAll('_', '-')}.entity.ts`
}

export default defineTemplate({
  name: 'TypeORM Entities',
  description: 'Generate TypeORM entity classes with decorators from SQL schema',
  language: 'typescript',

  generate(ctx) {
    const schema = enrichRealm(ctx)
    const tables = activeTables(schema)

    // Build lookup: table name -> EnrichedTable (for FK resolution)
    const tableByName = new Map<string, EnrichedTable>()
    const tableByQualified = new Map<string, EnrichedTable>()
    for (const t of tables) {
      tableByQualified.set(`${t.schema}.${t.name}`, t)
      if (!tableByName.has(t.name)) tableByName.set(t.name, t)
    }

    function resolveTable(name: string, schema?: string): EnrichedTable | undefined {
      if (schema) return tableByQualified.get(`${schema}.${name}`) ?? tableByName.get(name)
      return tableByName.get(name)
    }

    const files: Array<{ path: string; content: string }> = []

    for (const table of tables) {
      const entityName = table.pascalName
      const imports = new Set<string>()
      const entityImports = new Map<string, string>() // PascalName -> file path
      const lines: string[] = []

      // Determine decorator imports needed
      imports.add('Entity')
      imports.add('Column')

      const hasPK = table.columns.some((c) => c.isPrimaryKey)
      const isCompositePK = table.primaryKey.length > 1

      // Collect FK columns for relationship generation
      const fkColumns = table.columns.filter((c) => c.foreignKey)
      const hasManyToOne = fkColumns.length > 0
      const hasOneToMany = table.hasMany.length > 0

      if (hasPK && !isCompositePK) {
        imports.add('PrimaryGeneratedColumn')
      }
      if (isCompositePK) {
        imports.add('PrimaryColumn')
      }
      if (hasManyToOne) {
        imports.add('ManyToOne')
        imports.add('JoinColumn')
      }
      if (hasOneToMany) {
        imports.add('OneToMany')
      }

      // Collect entity imports from FK relationships
      for (const col of fkColumns) {
        const fk = col.foreignKey!
        const refTable = resolveTable(fk.table, fk.schema)
        if (refTable && refTable.name !== table.name) {
          entityImports.set(refTable.pascalName, toEntityFileName(refTable.name))
        }
      }
      for (const rel of table.hasMany) {
        const refTable = resolveTable(rel.foreignTable, rel.foreignSchema)
        if (refTable && refTable.name !== table.name) {
          entityImports.set(refTable.pascalName, toEntityFileName(refTable.name))
        }
      }

      // Build file header
      lines.push('// Generated by @sqldoc/templates/typeorm -- DO NOT EDIT')
      lines.push('')

      // TypeORM imports
      const sortedImports = [...imports].sort((a, b) => a.localeCompare(b))
      lines.push(`import { ${sortedImports.join(', ')} } from 'typeorm'`)

      // Entity imports (sorted for determinism)
      const sortedEntityImports = [...entityImports.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      for (const [name, file] of sortedEntityImports) {
        lines.push(`import { ${name} } from './${file}'`)
      }

      lines.push('')

      // @Entity decorator with schema-qualified table name
      if (table.sqlName !== table.name) {
        lines.push(`@Entity('${table.name}', { schema: '${table.schema}' })`)
      } else {
        lines.push(`@Entity('${table.name}')`)
      }
      lines.push(`export class ${entityName} {`)

      // Columns
      for (const col of table.columns) {
        const isPK = col.isPrimaryKey
        const isFKColumn = !!col.foreignKey

        // For FK columns, emit ManyToOne navigation property before the @Column
        if (isFKColumn) {
          const fk = col.foreignKey!
          const refTable = resolveTable(fk.table, fk.schema)
          const refName = refTable?.pascalName ?? toPascalCase(singularizeLast(fk.table))
          const navPropName = toCamelCase(singularizeLast(fk.table))
          const navType = col.nullable ? `${refName} | null` : refName

          lines.push(`  @ManyToOne(() => ${refName})`)
          lines.push(`  @JoinColumn({ name: '${col.name}' })`)
          lines.push(`  ${navPropName}!: ${navType}`)
          lines.push('')
          // Continue to also emit @Column for the FK id field below
        }

        // Column decorator
        const typeOrmCol = pgTypeToTypeOrmType(col.pgType, col.category)
        const tsType = col.typeOverride ?? pgTypeToTsType(col.pgType, col.nullable, col.category)
        const propName = toCamelCase(col.name)
        // Map camelCase property name back to snake_case column name when they differ
        const needsName = propName !== col.name

        if (isPK && !isCompositePK) {
          const pkOpts: string[] = [`type: '${typeOrmCol.type}'`]
          if (needsName) pkOpts.push(`name: '${col.name}'`)
          lines.push(`  @PrimaryGeneratedColumn({ ${pkOpts.join(', ')} })`)
        } else if (isPK && isCompositePK) {
          const opts: string[] = [`type: '${typeOrmCol.type}'`, 'primary: true']
          if (needsName) opts.push(`name: '${col.name}'`)
          if (typeOrmCol.array) opts.push('array: true')
          lines.push(`  @Column({ ${opts.join(', ')} })`)
        } else {
          const opts: string[] = [`type: '${typeOrmCol.type}'`]
          if (needsName) opts.push(`name: '${col.name}'`)
          if (typeOrmCol.array) opts.push('array: true')
          if (col.nullable) opts.push('nullable: true')
          if (col.defaultValue != null) {
            // Function defaults like now() need arrow syntax
            if (col.defaultValue.includes('(')) {
              opts.push(`default: () => '${col.defaultValue}'`)
            } else if (col.defaultValue === 'true' || col.defaultValue === 'false') {
              opts.push(`default: ${col.defaultValue}`)
            } else if (!Number.isNaN(Number(col.defaultValue))) {
              opts.push(`default: ${col.defaultValue}`)
            } else {
              opts.push(`default: ${JSON.stringify(col.defaultValue)}`)
            }
          }
          lines.push(`  @Column({ ${opts.join(', ')} })`)
        }

        lines.push(`  ${propName}!: ${tsType}`)
        lines.push('')
      }

      // OneToMany relationships (reverse FKs)
      for (const rel of table.hasMany) {
        const refTable = resolveTable(rel.foreignTable, rel.foreignSchema)
        if (!refTable) continue
        const refName = refTable.pascalName
        // The inverse side property name: what the FK column's nav property would be called
        const inverseProp = toCamelCase(singularizeLast(table.name))
        const propName = toCamelCase(refTable.name)

        lines.push(`  @OneToMany(`)
        lines.push(`    () => ${refName},`)
        lines.push(
          `    (${toCamelCase(singularizeLast(refTable.name))}: ${refName}) => ${toCamelCase(singularizeLast(refTable.name))}.${inverseProp},`,
        )
        lines.push(`  )`)
        lines.push(`  ${propName}!: ${refName}[]`)
        lines.push('')
      }

      lines.push('}')
      lines.push('')

      files.push({
        path: toEntityFileName(table.name),
        content: lines.join('\n'),
      })
    }

    return { files }
  },
})
