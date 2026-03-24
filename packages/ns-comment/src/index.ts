import type { TagContext, NamespacePlugin, SqlOutput } from '@sqldoc/core'

function escapeSql(str: string): string {
  return str.replace(/'/g, "''")
}

const plugin: NamespacePlugin = {
  apiVersion: 1,
  name: 'comment',
  tags: {
    $self: {
      description: 'Add a COMMENT ON statement to a table, column, view, function, type, or index',
      targets: ['table', 'column', 'view', 'function', 'type', 'index'],
      args: [{ type: 'string' }],
      validate: (ctx) => {
        const values = ctx.argValues as unknown[]
        const text = values[0] as string | undefined
        if (text && text.length < 10) {
          return { message: 'Consider a more descriptive comment', severity: 'info' }
        }
      },
    },
  },

  onTag(ctx: TagContext): SqlOutput[] | undefined {
    const { tag, target, objectName, columnName } = ctx

    if (tag.name !== '$self' && tag.name !== null) {
      return undefined
    }

    const args = tag.args as unknown[]
    const description = args[0] as string | undefined
    if (!description) return undefined

    const escaped = escapeSql(description)

    switch (target) {
      case 'column': {
        if (!columnName) return undefined
        return [{ sql: `COMMENT ON COLUMN "${objectName}"."${columnName}" IS '${escaped}';` }]
      }
      case 'table':
        return [{ sql: `COMMENT ON TABLE "${objectName}" IS '${escaped}';` }]
      case 'view':
        return [{ sql: `COMMENT ON VIEW "${objectName}" IS '${escaped}';` }]
      case 'function':
        return [{ sql: `COMMENT ON FUNCTION "${objectName}" IS '${escaped}';` }]
      case 'type':
        return [{ sql: `COMMENT ON TYPE "${objectName}" IS '${escaped}';` }]
      case 'index':
        return [{ sql: `COMMENT ON INDEX "${objectName}" IS '${escaped}';` }]
      default:
        return undefined
    }
  },
}

export default plugin
