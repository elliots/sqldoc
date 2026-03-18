import type { NamespacePlugin, TagContext, TagOutput } from '@sqldoc/core'

function commentOnSql(target: string, qualifiedName: string, message: string): string {
  return `COMMENT ON ${target} ${qualifiedName} IS '${message}';`
}

function targetKeyword(target: string): string {
  switch (target) {
    case 'table':
      return 'TABLE'
    case 'column':
      return 'COLUMN'
    case 'view':
      return 'VIEW'
    case 'function':
      return 'FUNCTION'
    case 'type':
      return 'TYPE'
    default:
      return target.toUpperCase()
  }
}

function qualifiedName(ctx: TagContext): string {
  if (ctx.target === 'column') {
    return `"${ctx.objectName}"."${ctx.columnName}"`
  }
  return `"${ctx.objectName}"`
}

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
    const { tag } = ctx
    const keyword = targetKeyword(ctx.target)
    const name = qualifiedName(ctx)
    const docTarget =
      ctx.target === 'column' ? { object: ctx.objectName, column: ctx.columnName } : { object: ctx.objectName }

    switch (tag.name) {
      case '$self':
      case null: {
        return {
          sql: [{ sql: commentOnSql(keyword, name, 'DEPRECATED') }],
          docs: {
            columns: [{ header: 'Status', ...docTarget, value: 'Deprecated' }],
          },
        }
      }
      case 'replace': {
        const args = tag.args as unknown[]
        const newName = args[0] as string
        return {
          sql: [{ sql: commentOnSql(keyword, name, `DEPRECATED: use ${newName} instead`) }],
          docs: {
            columns: [{ header: 'Status', ...docTarget, value: `Deprecated → ${newName}` }],
          },
        }
      }
      case 'remove': {
        const args = tag.args as unknown[]
        const date = args[0] as string
        return {
          sql: [{ sql: commentOnSql(keyword, name, `DEPRECATED: scheduled for removal after ${date}`) }],
          docs: {
            columns: [{ header: 'Status', ...docTarget, value: `Remove after ${date}` }],
          },
        }
      }
      default:
        return undefined
    }
  },
}

export default plugin
