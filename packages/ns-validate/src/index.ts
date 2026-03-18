import type { NamespacePlugin, TagContext, TagOutput } from '@sqldoc/core'

function isTextType(type: string | undefined): boolean {
  if (!type) return false
  const t = type.toLowerCase()
  return (
    t === 'text' ||
    t.startsWith('varchar') ||
    t.startsWith('character varying') ||
    t === 'char' ||
    t.startsWith('character')
  )
}

const plugin: NamespacePlugin = {
  apiVersion: 1,
  name: 'validate',
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
      description: 'Add a CHECK constraint using a PostgreSQL regex pattern',
      targets: ['column'],
      args: [{ type: 'string' }],
    },
  },

  onTag(ctx: TagContext): TagOutput | undefined {
    const { tag, objectName, columnName } = ctx

    switch (tag.name) {
      case 'check': {
        const expression = Array.isArray(tag.args)
          ? (tag.args[0] as string)
          : ((tag.args as Record<string, unknown>).positional as string)
        return {
          sql: [
            {
              sql: `ALTER TABLE "${objectName}" ADD CONSTRAINT "${objectName}_${columnName}_check" CHECK (${expression});`,
            },
          ],
        }
      }

      case 'notEmpty': {
        return {
          sql: [
            {
              sql: `ALTER TABLE "${objectName}" ADD CONSTRAINT "${objectName}_${columnName}_not_empty" CHECK (length(trim("${columnName}")) > 0);`,
            },
          ],
          docs: {
            columns: [{ header: 'Validation', object: objectName, column: columnName, value: 'Not empty' }],
          },
        }
      }

      case 'range': {
        const args = tag.args as Record<string, unknown>
        const min = args.min as number
        const max = args.max as number
        return {
          sql: [
            {
              sql: `ALTER TABLE "${objectName}" ADD CONSTRAINT "${objectName}_${columnName}_range" CHECK ("${columnName}" >= ${min} AND "${columnName}" <= ${max});`,
            },
          ],
          docs: {
            columns: [{ header: 'Validation', object: objectName, column: columnName, value: `Range: ${min}–${max}` }],
          },
        }
      }

      case 'length': {
        const args = tag.args as Record<string, unknown>
        const min = args.min as number | undefined
        const max = args.max as number | undefined
        let checkExpr: string
        let label: string
        if (min != null && max != null) {
          checkExpr = `length("${columnName}") >= ${min} AND length("${columnName}") <= ${max}`
          label = `Length: ${min}–${max}`
        } else if (min != null) {
          checkExpr = `length("${columnName}") >= ${min}`
          label = `Min length: ${min}`
        } else {
          checkExpr = `length("${columnName}") <= ${max}`
          label = `Max length: ${max}`
        }
        return {
          sql: [
            {
              sql: `ALTER TABLE "${objectName}" ADD CONSTRAINT "${objectName}_${columnName}_length" CHECK (${checkExpr});`,
            },
          ],
          docs: {
            columns: [{ header: 'Validation', object: objectName, column: columnName, value: label }],
          },
        }
      }

      case 'pattern': {
        const pattern = Array.isArray(tag.args)
          ? (tag.args[0] as string)
          : ((tag.args as Record<string, unknown>).positional as string)
        return {
          sql: [
            {
              sql: `ALTER TABLE "${objectName}" ADD CONSTRAINT "${objectName}_${columnName}_pattern" CHECK ("${columnName}" ~ '${pattern}');`,
            },
          ],
          docs: {
            columns: [{ header: 'Validation', object: objectName, column: columnName, value: `Pattern: ${pattern}` }],
          },
        }
      }

      default:
        return undefined
    }
  },

  lintRules: [
    {
      name: 'validate.require-pk',
      description: 'Tables should have a primary key',
      default: 'warn',
      check(ctx) {
        const diagnostics = []
        for (const output of ctx.outputs) {
          for (const obj of output.fileTags) {
            if (obj.target !== 'table') continue
            // Skip objects that look like column-level tags (table.column)
            if (obj.objectName.includes('.')) continue

            // Check if any tag indicates a primary key exists
            // We need to check the Atlas realm if available, or inspect the source SQL
            const hasPk = checkTableHasPk(output, obj.objectName)
            if (!hasPk) {
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
}

/** Check if a table has a primary key by inspecting the source SQL */
function checkTableHasPk(output: import('@sqldoc/core').CompilerOutput, tableName: string): boolean {
  const sql = output.mergedSql.toLowerCase()
  // Look for PRIMARY KEY in the CREATE TABLE statement for this table
  const tableRegex = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:"${tableName.toLowerCase()}"|${tableName.toLowerCase()})\\s*\\(([^;]*?)\\)`,
    'is',
  )
  const match = sql.match(tableRegex)
  if (!match) return true // If we can't find the table, don't flag it
  return match[1].includes('primary key')
}

export default plugin
