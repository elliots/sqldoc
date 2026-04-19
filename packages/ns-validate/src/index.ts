import {
  defineNamespace,
  escapeString,
  getPrimaryKeyColumns,
  getSchemaRealm,
  type LintDiagnostic,
  quoteIdentifier,
  type TagContext,
  type TagOutput,
} from '@sqldoc/core'

function isTextType(type: string | undefined): boolean {
  if (!type) return false
  const t = type.toLowerCase()
  return (
    t === 'text' ||
    t === 'ntext' ||
    t.startsWith('varchar') ||
    t.startsWith('nvarchar') ||
    t.startsWith('character varying') ||
    t === 'char' ||
    t === 'nchar' ||
    t.startsWith('character')
  )
}

function constraintName(table: string, column: string, suffix: string): string {
  return `${table}_${column}_${suffix}`
}

function handleCheck(ctx: TagContext): TagOutput | undefined {
  const { tag, objectName, columnName, dialect } = ctx
  if (dialect === 'sqlite') return { docs: undefined }

  const q = (name: string) => quoteIdentifier(name, dialect)
  // Trust boundary: expression is authored by the developer in their own schema
  // annotations and interpolated as raw SQL. Callers control the input.
  const expression = Array.isArray(tag.args)
    ? (tag.args[0] as string)
    : ((tag.args as Record<string, unknown>).positional as string)

  return {
    sql: [
      {
        sql: `ALTER TABLE ${q(objectName)} ADD CONSTRAINT ${q(constraintName(objectName, columnName!, 'check'))} CHECK (${expression});`,
      },
    ],
  }
}

function handleNotEmpty(ctx: TagContext): TagOutput {
  const { objectName, columnName, dialect } = ctx
  const q = (name: string) => quoteIdentifier(name, dialect)
  const docs = {
    columns: [{ header: 'Validation', object: objectName, column: columnName, value: 'Not empty' }],
  }

  if (dialect === 'sqlite') return { docs }

  const notEmptyExpr =
    dialect === 'mssql' ? `LEN(LTRIM(RTRIM(${q(columnName!)}))) > 0` : `length(trim(${q(columnName!)})) > 0`
  return {
    sql: [
      {
        sql: `ALTER TABLE ${q(objectName)} ADD CONSTRAINT ${q(constraintName(objectName, columnName!, 'not_empty'))} CHECK (${notEmptyExpr});`,
      },
    ],
    docs,
  }
}

function handleRange(ctx: TagContext): TagOutput {
  const { tag, objectName, columnName, dialect } = ctx
  const q = (name: string) => quoteIdentifier(name, dialect)
  const args = tag.args as Record<string, unknown>
  const min = args.min as number
  const max = args.max as number
  const docs = {
    columns: [{ header: 'Validation', object: objectName, column: columnName, value: `Range: ${min}\u2013${max}` }],
  }

  if (dialect === 'sqlite') return { docs }

  return {
    sql: [
      {
        sql: `ALTER TABLE ${q(objectName)} ADD CONSTRAINT ${q(constraintName(objectName, columnName!, 'range'))} CHECK (${q(columnName!)} >= ${min} AND ${q(columnName!)} <= ${max});`,
      },
    ],
    docs,
  }
}

function handleLength(ctx: TagContext): TagOutput {
  const { tag, objectName, columnName, dialect } = ctx
  const q = (name: string) => quoteIdentifier(name, dialect)
  const args = tag.args as Record<string, unknown>
  const min = args.min as number | undefined
  const max = args.max as number | undefined
  const lenFn = dialect === 'mssql' ? 'LEN' : 'length'

  let checkExpr: string
  let label: string
  if (min != null && max != null) {
    checkExpr = `${lenFn}(${q(columnName!)}) >= ${min} AND ${lenFn}(${q(columnName!)}) <= ${max}`
    label = `Length: ${min}\u2013${max}`
  } else if (min != null) {
    checkExpr = `${lenFn}(${q(columnName!)}) >= ${min}`
    label = `Min length: ${min}`
  } else {
    checkExpr = `${lenFn}(${q(columnName!)}) <= ${max}`
    label = `Max length: ${max}`
  }
  const docs = { columns: [{ header: 'Validation', object: objectName, column: columnName, value: label }] }

  if (dialect === 'sqlite') return { docs }

  return {
    sql: [
      {
        sql: `ALTER TABLE ${q(objectName)} ADD CONSTRAINT ${q(constraintName(objectName, columnName!, 'length'))} CHECK (${checkExpr});`,
      },
    ],
    docs,
  }
}

function handlePattern(ctx: TagContext): TagOutput {
  const { tag, objectName, columnName, dialect } = ctx
  const q = (name: string) => quoteIdentifier(name, dialect)
  const pattern = Array.isArray(tag.args)
    ? (tag.args[0] as string)
    : ((tag.args as Record<string, unknown>).positional as string)
  const docs = {
    columns: [{ header: 'Validation', object: objectName, column: columnName, value: `Pattern: ${pattern}` }],
  }

  if (dialect === 'sqlite' || dialect === 'mssql') return { docs }

  const regexOp = dialect === 'mysql' ? 'REGEXP' : '~'
  const escapedPattern = escapeString(pattern, dialect)
  return {
    sql: [
      {
        sql: `ALTER TABLE ${q(objectName)} ADD CONSTRAINT ${q(constraintName(objectName, columnName!, 'pattern'))} CHECK (${q(columnName!)} ${regexOp} ${escapedPattern});`,
      },
    ],
    docs,
  }
}

const plugin = defineNamespace({
  name: 'validate',
  description: 'Column-level validation constraints plus documentation and schema linting',
  engines: ['postgres', 'mysql', 'mssql', 'azuresql', 'sqlite'],
  tags: {
    check: {
      description: 'Add a CHECK constraint with a custom expression',
      targets: ['column'],
      args: {
        positional: { type: 'string', required: true },
      },
    },
    notEmpty: {
      description: 'Add a CHECK constraint ensuring the column is not empty (length(trim(col)) > 0)',
      targets: ['column'],
      validate: (ctx) => {
        if (!isTextType(ctx.columnType)) {
          return { message: 'notEmpty is typically used on text columns', severity: 'warning' }
        }
      },
    },
    range: {
      description: 'Add a CHECK constraint ensuring the column value is within a numeric range',
      targets: ['column'],
      args: {
        min: { type: 'number', required: true },
        max: { type: 'number', required: true },
      },
      validate: (ctx) => {
        const args = ctx.argValues as Record<string, unknown>
        const min = args.min as number
        const max = args.max as number
        if (min >= max) {
          return 'min must be less than max'
        }
      },
    },
    length: {
      description: 'Add a CHECK constraint on string length',
      targets: ['column'],
      args: {
        min: { type: 'number', required: false },
        max: { type: 'number', required: false },
      },
      validate: (ctx) => {
        const args = ctx.argValues as Record<string, unknown>
        if (args.min == null && args.max == null) {
          return 'at least one of min or max is required'
        }
        if (args.min != null && args.max != null && (args.min as number) >= (args.max as number)) {
          return 'min must be less than max'
        }
        if (!isTextType(ctx.columnType)) {
          return { message: 'length check is typically used on text columns', severity: 'warning' }
        }
      },
    },
    pattern: {
      description: 'Add a CHECK constraint using a regex pattern (~ for Postgres, REGEXP for MySQL)',
      targets: ['column'],
      args: [{ type: 'string' }],
    },
  },
  handlers: {
    check: handleCheck,
    notEmpty: handleNotEmpty,
    range: handleRange,
    length: handleLength,
    pattern: handlePattern,
  },
  examples: [
    {
      title: 'Add validation constraints',
      description:
        'Validation tags emit check constraints when the engine supports them and always enrich docs metadata.',
      engine: 'postgres',
      input: `CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  -- @validate.notEmpty
  name TEXT NOT NULL,
  -- @validate.range(min: 0, max: 99999)
  price NUMERIC(10,2) NOT NULL
);`,
      output: `ALTER TABLE "products" ADD CONSTRAINT "products_name_not_empty" CHECK (length(trim("name")) > 0);
ALTER TABLE "products" ADD CONSTRAINT "products_price_range" CHECK ("price" >= 0 AND "price" <= 99999);`,
    },
  ],
  lintRules: [
    {
      name: 'validate.require-pk',
      description: 'Tables should have a primary key',
      default: 'warn',
      check(ctx) {
        const diagnostics = [] as LintDiagnostic[]

        const realm = getSchemaRealm(ctx)
        if (!realm) return diagnostics

        const defaultSchema = realm.defaultSchema ?? ''
        const tablesWithPk = new Set<string>()
        for (const schema of realm.schemas) {
          for (const table of schema.tables ?? []) {
            if (getPrimaryKeyColumns(table).length === 0) continue

            const qualifiedName =
              schema.name && schema.name !== defaultSchema ? `${schema.name}.${table.name}` : table.name
            tablesWithPk.add(qualifiedName.toLowerCase())
          }
        }

        for (const output of ctx.outputs) {
          for (const obj of output.fileTags) {
            if (obj.target === 'column') continue
            if (obj.target !== 'table') continue

            if (!tablesWithPk.has(obj.objectName.toLowerCase())) {
              diagnostics.push({
                objectName: obj.objectName,
                sourceFile: output.sourceFile,
                message: `Table '${obj.objectName}' has no primary key`,
              })
            }
          }
        }
        return diagnostics
      },
    },
  ],
})

export default plugin
