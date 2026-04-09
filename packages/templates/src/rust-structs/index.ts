import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, enrichRealm } from '../helpers/enrich.ts'
import { toPascalCase } from '../helpers/naming.ts'
import { pgToRust } from '../types/pg-to-rust.ts'

export default defineTemplate({
  name: 'Rust Structs',
  description: 'Generate Rust structs with serde derives from SQL schema',
  language: 'rust',

  generate(ctx) {
    const schema = enrichRealm(ctx)
    const allImports = new Set<string>()
    allImports.add('serde::{Serialize, Deserialize}')
    const structs: string[] = []

    // Enums
    for (const e of schema.enums) {
      const enumName = toPascalCase(e.name)
      const variants = e.values.map((v) => {
        const variantName = toPascalCase(v)
        return `    #[serde(rename = "${v}")]\n    ${variantName},`
      })
      structs.push(`#[derive(Debug, Clone, Serialize, Deserialize)]\npub enum ${enumName} {\n${variants.join('\n')}\n}`)
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
    for (const fn of schema.functions) {
      if (fn.returnType?.category === 'composite' && fn.returnType.compositeFields?.length) {
        const typeName = fn.returnType.type.replace(/^setof\s+/i, '')
        if (!composites.has(typeName)) {
          composites.set(typeName, fn.returnType.compositeFields)
        }
      }
    }
    for (const [name, fields] of composites) {
      const structName = toPascalCase(name)
      const rustFields = fields.map((f) => {
        const mapped = pgToRust(f.type, false)
        for (const imp of mapped.imports) allImports.add(imp)
        return `    pub ${f.name}: ${mapped.type},`
      })
      structs.push(
        `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${structName} {\n${rustFields.join('\n')}\n}`,
      )
    }

    for (const table of activeTables(schema)) {
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

        // snake_case is the Rust convention, which matches PostgreSQL column names
        const fieldName = col.name
        fields.push(`    pub ${fieldName}: ${rustType},`)
      }

      structs.push('#[derive(Debug, Clone, Serialize, Deserialize)]')
      structs.push(`pub struct ${table.pascalName} {`)
      structs.push(fields.join('\n'))
      structs.push('}')
    }

    // Views (read-only)
    for (const view of schema.views.filter((v) => !v.skipped)) {
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

      structs.push(`/// Read-only (from view)`)
      structs.push('#[derive(Debug, Clone, Serialize, Deserialize)]')
      structs.push(`pub struct ${view.pascalName} {`)
      structs.push(fields.join('\n'))
      structs.push('}')
    }

    // Functions (skip trigger functions)
    for (const fn of schema.functions) {
      const retRaw = fn.returnType?.type?.toLowerCase() ?? ''
      if (retRaw === 'trigger') continue

      let retType: string
      if (retRaw.startsWith('setof ')) {
        const tableName = retRaw.replace('setof ', '')
        const table = schema.tables.find((t) => t.name === tableName || t.sqlName === tableName)
        retType = table
          ? `Vec<${table.pascalName}>`
          : composites.has(tableName)
            ? `Vec<${toPascalCase(tableName)}>`
            : `Vec<${pgToRust(tableName, false).type}>`
      } else if (fn.returnType) {
        const mapped = pgToRust(fn.returnType.type, false, fn.returnType.category)
        retType = mapped.type
        for (const imp of mapped.imports) allImports.add(imp)
      } else {
        retType = '()'
      }

      const argTypes = fn.args
        .filter((a) => !a.name?.startsWith('_') && (a as any).mode !== 'OUT')
        .map((a) => {
          const mapped = pgToRust(a.type, false, a.category)
          for (const imp of mapped.imports) allImports.add(imp)
          return mapped.type
        })

      structs.push(`pub type ${fn.pascalName} = fn(${argTypes.join(', ')}) -> ${retType};`)
    }

    if (structs.length === 0) {
      return { files: [] }
    }

    const sortedImports = [...allImports].sort((a, b) => a.localeCompare(b))
    const useLines = sortedImports.map((imp) => `use ${imp};`)

    const parts: string[] = []
    parts.push(useLines.join('\n'))
    parts.push('')
    parts.push(structs.join('\n\n'))
    parts.push('')

    return {
      files: [{ path: 'models.rs', content: parts.join('\n') }],
    }
  },
})
