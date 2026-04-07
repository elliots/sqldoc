import { defineTemplate } from '@sqldoc/ns-codegen'
import { activeTables, type EnrichedColumn, enrichRealm } from '../helpers/enrich.ts'
import { toPascalCase } from '../helpers/naming.ts'

export const configSchema = {
  mode: {
    type: 'enum',
    values: ['per-table', 'bundled'],
    description: 'Output one file per table or a single bundled file (default: bundled)',
  },
  $id: {
    type: 'string',
    description: 'Schema ID base URI (e.g. https://example.com/schemas)',
  },
} as const

const PG_TO_JSON_SCHEMA: Record<string, { type?: string; format?: string }> = {
  // Numeric -- integers
  smallint: { type: 'integer' },
  int2: { type: 'integer' },
  integer: { type: 'integer' },
  int: { type: 'integer' },
  int4: { type: 'integer' },
  bigint: { type: 'integer' },
  int8: { type: 'integer' },
  serial: { type: 'integer' },
  serial4: { type: 'integer' },
  bigserial: { type: 'integer' },
  serial8: { type: 'integer' },
  smallserial: { type: 'integer' },
  serial2: { type: 'integer' },

  // Numeric -- floats
  real: { type: 'number' },
  float4: { type: 'number' },
  'double precision': { type: 'number' },
  float8: { type: 'number' },
  numeric: { type: 'number' },
  decimal: { type: 'number' },
  money: { type: 'string' },

  // String
  text: { type: 'string' },
  varchar: { type: 'string' },
  'character varying': { type: 'string' },
  char: { type: 'string' },
  character: { type: 'string' },
  name: { type: 'string' },
  citext: { type: 'string' },

  // Boolean
  boolean: { type: 'boolean' },
  bool: { type: 'boolean' },

  // Date/Time
  timestamp: { type: 'string', format: 'date-time' },
  'timestamp without time zone': { type: 'string', format: 'date-time' },
  timestamptz: { type: 'string', format: 'date-time' },
  'timestamp with time zone': { type: 'string', format: 'date-time' },
  date: { type: 'string', format: 'date' },
  time: { type: 'string', format: 'time' },
  'time without time zone': { type: 'string', format: 'time' },
  timetz: { type: 'string', format: 'time' },
  'time with time zone': { type: 'string', format: 'time' },
  interval: { type: 'string', format: 'duration' },

  // Binary
  bytea: { type: 'string', format: 'byte' },

  // JSON
  json: {},
  jsonb: {},

  // UUID
  uuid: { type: 'string', format: 'uuid' },

  // Network
  inet: { type: 'string', format: 'ipv4' },
  cidr: { type: 'string' },
  macaddr: { type: 'string' },
  macaddr8: { type: 'string' },

  // Other
  xml: { type: 'string' },
  tsvector: { type: 'string' },
  tsquery: { type: 'string' },
  oid: { type: 'integer' },
}

function pgToJsonSchema(pgType: string): Record<string, unknown> {
  const normalized = pgType.toLowerCase().trim()

  // Arrays
  if (normalized.endsWith('[]')) {
    return { type: 'array', items: pgToJsonSchema(normalized.slice(0, -2)) }
  }
  if (normalized.startsWith('_')) {
    return { type: 'array', items: pgToJsonSchema(normalized.slice(1)) }
  }

  // Strip length specifiers
  const baseType = normalized.replace(/\(\d+(?:,\s*\d+)?\)/, '').trim()

  const mapped = PG_TO_JSON_SCHEMA[baseType]
  if (mapped) return { ...mapped }

  // JSON types -- no type constraint (any valid JSON)
  if (baseType === 'json' || baseType === 'jsonb') return {}

  return { type: 'string' }
}

function applyValidation(prop: Record<string, unknown>, col: EnrichedColumn): void {
  for (const t of col.tags) {
    if (t.namespace !== 'validate') continue

    if (t.tag === 'notEmpty') {
      if (prop.type === 'string') prop.minLength = 1
      if (prop.type === 'array') prop.minItems = 1
    } else if (t.tag === 'email') {
      prop.format = 'email'
    } else if (t.tag === 'length') {
      const args = t.args as Record<string, unknown>
      if (args.min !== undefined) prop.minLength = Number(args.min)
      if (args.max !== undefined) prop.maxLength = Number(args.max)
    } else if (t.tag === 'range') {
      const args = t.args as Record<string, unknown>
      if (args.min !== undefined) prop.minimum = Number(args.min)
      if (args.max !== undefined) prop.maximum = Number(args.max)
    } else if (t.tag === 'pattern') {
      const pattern = Array.isArray(t.args) ? t.args[0] : undefined
      if (pattern) prop.pattern = String(pattern)
    } else if (t.tag === 'min') {
      const val = Array.isArray(t.args) ? t.args[0] : undefined
      if (val !== undefined) {
        if (prop.type === 'string') prop.minLength = Number(val)
        else prop.minimum = Number(val)
      }
    } else if (t.tag === 'max') {
      const val = Array.isArray(t.args) ? t.args[0] : undefined
      if (val !== undefined) {
        if (prop.type === 'string') prop.maxLength = Number(val)
        else prop.maximum = Number(val)
      }
    }
  }
}

function buildTableSchema(
  table: ReturnType<typeof activeTables>[number],
  baseId?: string,
  _enumDefs?: Map<string, string[]>,
): Record<string, unknown> {
  const required: string[] = []
  const properties: Record<string, Record<string, unknown>> = {}

  for (const col of table.columns) {
    let prop: Record<string, unknown>

    if (col.category === 'enum' && col.enumValues?.length) {
      prop = { type: 'string', enum: col.enumValues }
    } else {
      prop = pgToJsonSchema(col.pgType)
    }

    if (!col.nullable) required.push(col.name)

    applyValidation(prop, col)

    properties[col.name] = prop
  }

  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
  }

  if (required.length > 0) schema.required = required
  if (baseId) schema.$id = `${baseId}/${table.sqlName}`

  return schema
}

function buildViewSchema(
  view: { pascalName: string; name: string; sqlName: string; columns: EnrichedColumn[] },
  baseId?: string,
): Record<string, unknown> {
  const required: string[] = []
  const properties: Record<string, Record<string, unknown>> = {}

  for (const col of view.columns) {
    let prop: Record<string, unknown>

    if (col.category === 'enum' && col.enumValues?.length) {
      prop = { type: 'string', enum: col.enumValues }
    } else {
      prop = pgToJsonSchema(col.pgType)
    }

    if (!col.nullable) required.push(col.name)

    applyValidation(prop, col)

    properties[col.name] = prop
  }

  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
    readOnly: true,
  }

  if (required.length > 0) schema.required = required
  if (baseId) schema.$id = `${baseId}/${view.sqlName}`

  return schema
}

export default defineTemplate({
  name: 'JSON Schema',
  description: 'Generate JSON Schema definitions from SQL schema',
  language: 'json',
  configSchema,

  generate(ctx) {
    const config = ctx.config ?? {}
    const schema = enrichRealm(ctx)
    const tables = activeTables(schema)
    const views = schema.views.filter((v) => !v.skipped)
    const baseId = config.$id

    // Collect composite types from columns
    const composites = new Map<string, Array<{ name: string; type: string }>>()
    for (const table of schema.tables) {
      for (const col of table.columns) {
        if (col.category === 'composite' && col.compositeFields?.length && !composites.has(col.pgType)) {
          composites.set(col.pgType, col.compositeFields)
        }
      }
    }

    if (config.mode === 'per-table') {
      const files = [
        ...tables.map((table) => ({
          path: `${table.sqlName.replaceAll('.', '-')}.schema.json`,
          content: `${JSON.stringify(
            { $schema: 'https://json-schema.org/draft/2020-12/schema', ...buildTableSchema(table, baseId) },
            null,
            2,
          )}\n`,
        })),
        ...views.map((view) => ({
          path: `${view.sqlName.replaceAll('.', '-')}.schema.json`,
          content: `${JSON.stringify(
            { $schema: 'https://json-schema.org/draft/2020-12/schema', ...buildViewSchema(view, baseId) },
            null,
            2,
          )}\n`,
        })),
      ]
      return { files }
    }

    // Bundled mode (default): all tables as $defs with top-level oneOf
    const defs: Record<string, Record<string, unknown>> = {}

    // Enum definitions
    for (const e of schema.enums) {
      defs[e.pascalName] = { type: 'string', enum: e.values }
    }

    // Composite type definitions
    for (const [name, fields] of composites) {
      const props: Record<string, Record<string, unknown>> = {}
      const req: string[] = []
      for (const f of fields) {
        props[f.name] = pgToJsonSchema(f.type)
        req.push(f.name)
      }
      const compSchema: Record<string, unknown> = { type: 'object', properties: props }
      if (req.length > 0) compSchema.required = req
      defs[toPascalCase(name)] = compSchema
    }

    for (const table of tables) {
      defs[table.pascalName] = buildTableSchema(table, baseId)
    }

    for (const view of views) {
      defs[view.pascalName] = buildViewSchema(view, baseId)
    }

    // Function schemas (skip trigger functions)
    for (const fn of schema.functions) {
      const retRaw = fn.returnType?.type?.toLowerCase() ?? ''
      if (retRaw === 'trigger') continue

      const params: Record<string, Record<string, unknown>> = {}
      const paramRequired: string[] = []
      for (const a of fn.args.filter((a) => !a.name?.startsWith('_') && (a as any).mode !== 'OUT')) {
        const argName = a.name || 'arg'
        params[argName] = pgToJsonSchema(a.type)
        paramRequired.push(argName)
      }

      let returnSchema: Record<string, unknown>
      if (retRaw.startsWith('setof ')) {
        const tableName = retRaw.replace('setof ', '')
        const table = schema.tables.find((t) => t.name === tableName || t.sqlName === tableName)
        if (table) {
          returnSchema = { type: 'array', items: { $ref: `#/$defs/${table.pascalName}` } }
        } else {
          returnSchema = { type: 'array', items: pgToJsonSchema(tableName) }
        }
      } else if (fn.returnType) {
        returnSchema = pgToJsonSchema(fn.returnType.type)
      } else {
        returnSchema = {}
      }

      const fnSchema: Record<string, unknown> = {
        type: 'object',
        properties: {
          parameters: {
            type: 'object',
            properties: params,
            ...(paramRequired.length > 0 ? { required: paramRequired } : {}),
          },
          returnType: returnSchema,
        },
      }

      defs[fn.pascalName] = fnSchema
    }

    const bundled: Record<string, unknown> = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: defs,
    }
    if (baseId) bundled.$id = baseId

    return {
      files: [
        {
          path: 'schema.json',
          content: `${JSON.stringify(bundled, null, 2)}\n`,
        },
      ],
    }
  },
})
