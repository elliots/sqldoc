import type { NamespacePlugin, TagContext, TagOutput } from '@sqldoc/core'
import { escapeString, quoteIdentifier } from '@sqldoc/core'

const plugin: NamespacePlugin = {
  apiVersion: 1,
  name: 'deprecated',
  tags: {
    $self: {
      description: 'Mark this SQL object as deprecated',
      targets: ['table', 'column', 'view', 'function', 'type'],
    },
    replace: {
      description: 'Mark as deprecated with a replacement suggestion',
      targets: ['table', 'column', 'view', 'function', 'type'],
      args: [{ type: 'string' }],
    },
    remove: {
      description: 'Mark as deprecated with a scheduled removal date',
      targets: ['table', 'column', 'view', 'function', 'type'],
      args: [{ type: 'string' }],
    },
  },

  onTag(ctx: TagContext): TagOutput | undefined {
    const { tag, target, objectName, columnName, dialect } = ctx
    const q = (name: string) => quoteIdentifier(name, dialect)
    const esc = (s: string) => escapeString(s, dialect)

    const docTarget = target === 'column' ? { object: objectName, column: columnName } : { object: objectName }

    // Determine the deprecation message and docs value
    let message: string
    let docsValue: string
    switch (tag.name) {
      case '$self':
      case null:
        message = 'DEPRECATED'
        docsValue = 'Deprecated'
        break
      case 'replace': {
        const args = tag.args as unknown[]
        const newName = args[0] as string
        message = `DEPRECATED: use ${newName} instead`
        docsValue = `Deprecated \u2192 ${newName}`
        break
      }
      case 'remove': {
        const args = tag.args as unknown[]
        const date = args[0] as string
        message = `DEPRECATED: scheduled for removal after ${date}`
        docsValue = `Remove after ${date}`
        break
      }
      default:
        return undefined
    }

    const docs = {
      columns: [{ header: 'Status', ...docTarget, value: docsValue }],
    }

    // Generate dialect-specific SQL
    switch (dialect) {
      case 'postgres': {
        const keyword = target.toUpperCase()
        const name = target === 'column' ? `${q(objectName)}.${q(columnName!)}` : q(objectName)
        return {
          sql: [{ sql: `COMMENT ON ${keyword} ${name} IS ${esc(message)};` }],
          docs,
        }
      }

      case 'mysql': {
        if (target === 'table') {
          return {
            sql: [{ sql: `ALTER TABLE ${q(objectName)} COMMENT = ${esc(message)};` }],
            docs,
          }
        }
        if (target === 'column') {
          const colType = ctx.columnType ?? 'TEXT'
          return {
            sql: [
              {
                sql: `ALTER TABLE ${q(objectName)} MODIFY COLUMN ${q(columnName!)} ${colType} COMMENT ${esc(message)};`,
              },
            ],
            docs,
          }
        }
        // MySQL cannot comment on views, functions, or types -- docs-only output
        return { sql: [], docs }
      }

      case 'sqlite':
        // SQLite has no comment support -- docs-only output
        return { sql: [], docs }
    }
  },
}

export default plugin
