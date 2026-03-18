import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, enrichRealm } from '../helpers/enrich.ts'
import { toPascalCase } from '../helpers/naming.ts'
import { pgToRust } from '../types/pg-to-rust.ts'

/**
 * Mapping from PostgreSQL types to Diesel SQL types.
 */
const PG_TO_DIESEL: Record<string, string> = {
  smallint: 'SmallInt',
  int2: 'SmallInt',
  integer: 'Integer',
  int: 'Integer',
  int4: 'Integer',
  bigint: 'BigInt',
  int8: 'BigInt',
  serial: 'Integer',
  serial4: 'Integer',
  bigserial: 'BigInt',
  serial8: 'BigInt',
  smallserial: 'SmallInt',
  serial2: 'SmallInt',
  real: 'Float',
  float4: 'Float',
  'double precision': 'Double',
  float8: 'Double',
  numeric: 'Numeric',
  decimal: 'Numeric',
  text: 'Text',
  varchar: 'Text',
  'character varying': 'Text',
  char: 'Text',
  character: 'Text',
  name: 'Text',
  citext: 'Text',
  boolean: 'Bool',
  bool: 'Bool',
  timestamp: 'Timestamp',
  'timestamp without time zone': 'Timestamp',
  timestamptz: 'Timestamptz',
  'timestamp with time zone': 'Timestamptz',
  date: 'Date',
  time: 'Time',
  'time without time zone': 'Time',
  bytea: 'Bytea',
  json: 'Jsonb',
  jsonb: 'Jsonb',
  uuid: 'Uuid',
  inet: 'Inet',
  money: 'Money',
}

/**
 * Map a PostgreSQL column type to Diesel's SQL type name.
 */
function pgToDieselType(pgType: string, nullable: boolean): string {
  const normalized = pgType.toLowerCase().trim()

  // Handle arrays
  if (normalized.endsWith('[]') || normalized.startsWith('_')) {
    const baseType = normalized.endsWith('[]') ? normalized.slice(0, -2) : normalized.slice(1)
    const inner = pgToDieselType(baseType, false)
    const arrayType = `Array<${inner}>`
    return nullable ? `Nullable<${arrayType}>` : arrayType
  }

  // Strip length specifiers
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()
  const dieselType = PG_TO_DIESEL[baseType] ?? 'Text'

  return nullable ? `Nullable<${dieselType}>` : dieselType
}

export default defineTemplate({
  name: 'Diesel Schema',
  description: 'Generate Diesel table! macros and Queryable structs from SQL schema',
  language: 'rust',

  generate(ctx) {
    const schema = enrichRealm(ctx)
    const tableMacros: string[] = []
    const modelStructs: string[] = []
    const allImports = new Set<string>()
    allImports.add('serde::{Serialize, Deserialize}')

    // Enums
    const enumBlocks: string[] = []
    for (const e of schema.enums) {
      const enumName = toPascalCase(e.name)
      const variants = e.values.map((v) => {
        const variantName = toPascalCase(v)
        return `    #[serde(rename = "${v}")]\n    ${variantName},`
      })
      enumBlocks.push(
        `#[derive(Debug, Clone, Serialize, Deserialize, diesel_derive_enum::DbEnum)]\npub enum ${enumName} {\n${variants.join('\n')}\n}`,
      )
    }

    // Composite types as structs
    const composites = new Map<string, Array<{ name: string; type: string }>>()
    for (const table of schema.tables) {
      for (const col of table.columns) {
        if (col.category === 'composite' && col.compositeFields?.length && !composites.has(col.pgType)) {
          composites.set(col.pgType, col.compositeFields)
        }
      }
    }
    const compositeBlocks: string[] = []
    for (const [name, fields] of composites) {
      const structName = toPascalCase(name)
      const rustFields = fields.map((f) => {
        const mapped = pgToRust(f.type, false)
        for (const imp of mapped.imports) allImports.add(imp)
        return `    pub ${f.name}: ${mapped.type},`
      })
      compositeBlocks.push(
        `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${structName} {\n${rustFields.join('\n')}\n}`,
      )
    }

    for (const table of activeTables(schema)) {
      // Determine PK column
      const pkColumn = table.primaryKey[0] ?? 'id'

      // Generate table! macro
      const macroColumns: string[] = []
      for (const col of table.columns) {
        const dieselType =
          col.category === 'enum'
            ? 'Text'
            : col.category === 'composite'
              ? 'Text'
              : pgToDieselType(col.pgType, col.nullable)
        macroColumns.push(`        ${col.name} -> ${dieselType},`)
      }

      tableMacros.push(`diesel::table! {`)
      tableMacros.push(`    ${table.name} (${pkColumn}) {`)
      tableMacros.push(macroColumns.join('\n'))
      tableMacros.push(`    }`)
      tableMacros.push(`}`)

      // Generate Queryable struct
      const fields: string[] = []
      for (const col of table.columns) {
        let rustType: string
        if (col.typeOverride) {
          rustType = col.nullable ? `Option<${col.typeOverride}>` : col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          const enumType = toPascalCase(col.pgType)
          rustType = col.nullable ? `Option<${enumType}>` : enumType
        } else if (col.category === 'composite' && col.compositeFields?.length) {
          const compositeType = toPascalCase(col.pgType)
          rustType = col.nullable ? `Option<${compositeType}>` : compositeType
        } else {
          const mapped = pgToRust(col.pgType, col.nullable, col.category)
          rustType = mapped.type
          for (const imp of mapped.imports) allImports.add(imp)
        }

        fields.push(`    pub ${col.name}: ${rustType},`)
      }

      modelStructs.push('#[derive(Debug, Clone, Queryable, Selectable, Serialize, Deserialize)]')
      modelStructs.push(`#[diesel(table_name = ${table.name})]`)
      modelStructs.push(`pub struct ${table.pascalName} {`)
      modelStructs.push(fields.join('\n'))
      modelStructs.push('}')
    }

    // Views (read-only) — generate both view schema and Queryable struct
    for (const view of schema.views.filter((v) => !v.skipped)) {
      // Generate table! macro for the view (Diesel uses table! for views too)
      const macroColumns: string[] = []
      const firstCol = view.columns[0]?.name ?? 'id'
      for (const col of view.columns) {
        const dieselType =
          col.category === 'enum'
            ? 'Text'
            : col.category === 'composite'
              ? 'Text'
              : pgToDieselType(col.pgType, col.nullable)
        macroColumns.push(`        ${col.name} -> ${dieselType},`)
      }

      tableMacros.push(`diesel::table! {`)
      tableMacros.push(`    ${view.name} (${firstCol}) {`)
      tableMacros.push(macroColumns.join('\n'))
      tableMacros.push(`    }`)
      tableMacros.push(`}`)

      const fields: string[] = []
      for (const col of view.columns) {
        let rustType: string
        if (col.typeOverride) {
          rustType = col.nullable ? `Option<${col.typeOverride}>` : col.typeOverride
        } else if (col.category === 'enum' && col.enumValues?.length) {
          const enumType = toPascalCase(col.pgType)
          rustType = col.nullable ? `Option<${enumType}>` : enumType
        } else if (col.category === 'composite' && col.compositeFields?.length) {
          const compositeType = toPascalCase(col.pgType)
          rustType = col.nullable ? `Option<${compositeType}>` : compositeType
        } else {
          const mapped = pgToRust(col.pgType, col.nullable, col.category)
          rustType = mapped.type
          for (const imp of mapped.imports) allImports.add(imp)
        }

        fields.push(`    pub ${col.name}: ${rustType},`)
      }

      modelStructs.push(`/// Read-only (from view)`)
      modelStructs.push('#[derive(Debug, Clone, Queryable, Serialize, Deserialize)]')
      modelStructs.push(`pub struct ${view.pascalName} {`)
      modelStructs.push(fields.join('\n'))
      modelStructs.push('}')
    }

    if (tableMacros.length === 0 && enumBlocks.length === 0 && compositeBlocks.length === 0) {
      return { files: [] }
    }

    // schema.rs
    const schemaContent = `${tableMacros.join('\n\n')}\n`

    // models.rs
    const sortedImports = [...allImports].sort()
    const useLines = sortedImports.map((imp) => `use ${imp};`)
    const modelsContent = [
      'use diesel::prelude::*;',
      'use crate::schema::*;',
      ...useLines,
      '',
      ...(enumBlocks.length > 0 ? [...enumBlocks, ''] : []),
      ...(compositeBlocks.length > 0 ? [...compositeBlocks, ''] : []),
      modelStructs.join('\n\n'),
      '',
    ].join('\n')

    return {
      files: [
        { path: 'schema.rs', content: schemaContent },
        { path: 'models.rs', content: modelsContent },
      ],
    }
  },
})
