import { pgToTs, type TsTypeOptions } from '../types/pg-to-ts.ts'
import type { EnrichedColumn, EnrichedFunction, EnrichedSchema } from './enrich.ts'
import { toCamelCase, toPascalCase } from './naming.ts'

export interface CompositeTypeDef {
  name: string
  typeName: string
  fields: Array<{ name: string; type: string }>
}

export interface FunctionParam {
  name: string
  type: string
}

export function hasJsonTypes(schema: EnrichedSchema): boolean {
  const allCols = [...schema.tables.flatMap((t) => t.columns), ...schema.views.flatMap((v) => v.columns)]
  return (
    allCols.some((c) => c.category === 'json' || c.pgType === 'json' || c.pgType === 'jsonb') ||
    schema.functions.some(
      (fn) =>
        fn.args.some((a) => a.type === 'json' || a.type === 'jsonb') ||
        ['json', 'jsonb'].includes(fn.returnType?.type?.toLowerCase() ?? ''),
    )
  )
}

export function collectCompositeTypes(schema: EnrichedSchema): Map<string, CompositeTypeDef> {
  const composites = new Map<string, CompositeTypeDef>()

  for (const table of schema.tables) {
    for (const col of table.columns) {
      if (col.category === 'composite' && col.compositeFields?.length && !composites.has(col.pgType)) {
        composites.set(col.pgType, {
          name: col.pgType,
          typeName: toPascalCase(col.pgType),
          fields: col.compositeFields,
        })
      }
    }
  }

  for (const fn of schema.functions) {
    if (fn.returnType?.category === 'composite' && fn.returnType.compositeFields?.length) {
      const name = fn.returnType.type.replace(/^setof\s+/i, '')
      if (!composites.has(name)) {
        composites.set(name, {
          name,
          typeName: toPascalCase(name),
          fields: fn.returnType.compositeFields,
        })
      }
    }
  }

  return composites
}

export function emitCompositeInterfaces(
  lines: string[],
  composites: Map<string, CompositeTypeDef>,
  options: TsTypeOptions,
): void {
  for (const composite of composites.values()) {
    lines.push(`export interface ${composite.typeName} {`)
    for (const f of composite.fields) {
      lines.push(`  ${toCamelCase(f.name)}: ${pgToTs(f.type, false, options)}`)
    }
    lines.push('}')
    lines.push('')
  }
}

export function inputFunctionParams(fn: EnrichedFunction, options: TsTypeOptions): FunctionParam[] {
  const usedNames = new Set<string>()
  return fn.args
    .filter((a) => !a.name?.startsWith('_') && a.mode !== 'OUT')
    .map((a, i) => {
      const type = pgToTs(a.type, false, options, a.category)
      let name = a.name ? toCamelCase(a.name) : `arg${i + 1}`
      if (usedNames.has(name)) name = `${name}${i + 1}`
      usedNames.add(name)
      return { name, type }
    })
}

export function resolveTsColumnType(
  col: EnrichedColumn,
  options: TsTypeOptions,
  nullableStyle: 'optional' | 'null-union' | undefined = options.nullableStyle,
): string {
  if (col.typeOverride) return col.typeOverride
  if (col.category === 'enum' && col.enumValues?.length) {
    const enumType = toPascalCase(col.pgType)
    return col.nullable && nullableStyle === 'null-union' ? `${enumType} | null` : enumType
  }
  if (col.category === 'composite' && col.compositeFields?.length) {
    const compositeType = toPascalCase(col.pgType)
    return col.nullable && nullableStyle === 'null-union' ? `${compositeType} | null` : compositeType
  }
  return pgToTs(col.pgType, col.nullable && nullableStyle === 'null-union', options, col.category)
}

export function resolveFunctionReturnType(
  fn: EnrichedFunction,
  schema: EnrichedSchema,
  options: TsTypeOptions,
  composites: Map<string, CompositeTypeDef>,
  tableSuffix = '',
): string {
  const retRaw = fn.returnType?.type?.toLowerCase() ?? ''
  if (retRaw.startsWith('setof ')) {
    const tableName = retRaw.replace('setof ', '')
    const table = schema.tables.find((t) => t.name === tableName || t.sqlName === tableName)
    if (table) return `${table.pascalName}${tableSuffix}[]`
    if (composites.has(tableName)) return `${composites.get(tableName)!.typeName}[]`
    return `${pgToTs(tableName, false, options)}[]`
  }
  if (fn.returnType) return pgToTs(fn.returnType.type, false, options, fn.returnType.category)
  return tableSuffix ? 'void' : 'unknown[]'
}

function quoteSqlIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

export function qualifiedFunctionSqlName(fn: EnrichedFunction, defaultSchema?: string): string {
  const fnName = quoteSqlIdentifier(fn.name)
  return fn.schema && fn.schema !== defaultSchema ? `${quoteSqlIdentifier(fn.schema)}.${fnName}` : fnName
}
