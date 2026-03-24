import { escapeString, quoteIdentifier } from '@sqldoc/core'
import type { NamespacePlugin, SqlOutput, TagContext } from '@sqldoc/core'

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
    const { tag, target, objectName, columnName, dialect } = ctx

    if (tag.name !== '$self' && tag.name !== null) {
      return undefined
    }

    const args = tag.args as unknown[]
    const description = args[0] as string | undefined
    if (!description) return undefined

    const q = (name: string) => quoteIdentifier(name, dialect)
    const esc = (s: string) => escapeString(s, dialect)

    switch (dialect) {
      case 'postgres': {
        switch (target) {
          case 'column': {
            if (!columnName) return undefined
            return [{ sql: `COMMENT ON COLUMN ${q(objectName)}.${q(columnName)} IS ${esc(description)};` }]
          }
          case 'table':
            return [{ sql: `COMMENT ON TABLE ${q(objectName)} IS ${esc(description)};` }]
          case 'view':
            return [{ sql: `COMMENT ON VIEW ${q(objectName)} IS ${esc(description)};` }]
          case 'function':
            return [{ sql: `COMMENT ON FUNCTION ${q(objectName)} IS ${esc(description)};` }]
          case 'type':
            return [{ sql: `COMMENT ON TYPE ${q(objectName)} IS ${esc(description)};` }]
          case 'index':
            return [{ sql: `COMMENT ON INDEX ${q(objectName)} IS ${esc(description)};` }]
          default:
            return undefined
        }
      }

      case 'mysql': {
        if (target === 'table') {
          return [{ sql: `ALTER TABLE ${q(objectName)} COMMENT = ${esc(description)};` }]
        }
        if (target === 'column') {
          if (!columnName) return undefined
          const colType = ctx.columnType ?? 'TEXT'
          return [
            {
              sql: `ALTER TABLE ${q(objectName)} MODIFY COLUMN ${q(columnName)} ${colType} COMMENT ${esc(description)};`,
            },
          ]
        }
        // MySQL cannot comment on views, functions, types, or indexes
        return undefined
      }

      case 'sqlite':
        // SQLite has no comment support
        return undefined
    }
  },
}

export default plugin
