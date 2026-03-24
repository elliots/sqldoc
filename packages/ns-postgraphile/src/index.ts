import type { NamespacePlugin, SqlOutput, TagContext, TagOutput } from '@sqldoc/core'

function commentTarget(target: string, objectName: string, columnName?: string): string {
  switch (target) {
    case 'column':
      return `COLUMN "${objectName}"."${columnName}"`
    case 'table':
      return `TABLE "${objectName}"`
    case 'view':
      return `VIEW "${objectName}"`
    case 'function':
      return `FUNCTION "${objectName}"`
    case 'type':
      return `TYPE "${objectName}"`
    default:
      return `TABLE "${objectName}"`
  }
}

function tagLine(entry: { tag: string | null; args: Record<string, unknown> | unknown[] }): string {
  const name = entry.tag
  const args = entry.args

  switch (name) {
    case '$self':
    case null:
      return ''
    case 'omit':
      return '@omit'
    case 'omit.operations': {
      const namedArgs = args as Record<string, unknown>
      const ops = namedArgs.ops as string[]
      return `@omit ${ops.join(',')}`
    }
    case 'name': {
      const positional = args as unknown[]
      return `@name ${positional[0]}`
    }
    case 'deprecated': {
      const positional = args as unknown[]
      const reason = positional.length > 0 ? positional[0] : 'Deprecated'
      return `@deprecated ${reason}`
    }
    case 'simpleCollections':
      return '@simpleCollections only'
    case 'behavior': {
      const positional = args as unknown[]
      return `@behavior ${positional[0]}`
    }
    default:
      return ''
  }
}

/** Build a human-readable GraphQL doc label from all pg tags on this object */
function buildGraphqlLabel(
  namespaceTags: Array<{ tag: string | null; args: Record<string, unknown> | unknown[] }>,
): string | undefined {
  const parts: string[] = []
  for (const entry of namespaceTags) {
    switch (entry.tag) {
      case 'omit':
        parts.push('Omitted')
        break
      case 'omit.operations': {
        const ops = (entry.args as Record<string, unknown>).ops as string[]
        parts.push(`Omit: ${ops.join(', ')}`)
        break
      }
      case 'name': {
        const name = (entry.args as unknown[])[0]
        parts.push(`→ ${name}`)
        break
      }
      case 'simpleCollections':
        parts.push('Simple collections')
        break
      case 'behavior': {
        const b = (entry.args as unknown[])[0]
        parts.push(`Behavior: ${b}`)
        break
      }
    }
  }
  return parts.length > 0 ? parts.join(', ') : undefined
}

const plugin: NamespacePlugin = {
  apiVersion: 1,
  databases: ['postgres'],
  description: 'PostGraphile smart comments for PostgreSQL',
  name: 'pg',
  tags: {
    omit: {
      description: 'Omit this object from the PostGraphile GraphQL schema',
      targets: ['table', 'column', 'view', 'function'],
      args: {},
    },
    'omit.operations': {
      description: 'Omit specific operations from the PostGraphile GraphQL schema',
      targets: ['table', 'column', 'view', 'function'],
      args: {
        ops: {
          type: 'array',
          items: { type: 'enum', values: ['create', 'read', 'update', 'delete', 'all', 'many'] },
          required: true,
        },
      },
    },
    name: {
      description: 'Rename this object in the PostGraphile GraphQL schema',
      targets: ['table', 'column', 'view', 'function', 'type'],
      args: [{ type: 'string' }],
    },
    deprecated: {
      description: 'Mark this object as deprecated in the PostGraphile GraphQL schema',
      targets: ['table', 'column', 'view', 'function', 'type'],
      args: [{ type: 'string' }],
    },
    simpleCollections: {
      description: 'Enable simple collections on this table or view in PostGraphile',
      targets: ['table', 'view'],
      args: {},
    },
    behavior: {
      description: 'Set a custom behavior string (PostGraphile V5)',
      targets: ['table', 'column', 'view', 'function', 'type'],
      args: [{ type: 'string' }],
    },
  },

  onTag(ctx: TagContext): TagOutput | undefined {
    const { tag, objectName, columnName, target, namespaceTags } = ctx

    // Only generate on the FIRST pg tag — combines all into one COMMENT ON
    const firstTag = namespaceTags[0]
    if (firstTag.tag !== tag.name || JSON.stringify(firstTag.args) !== JSON.stringify(tag.args)) {
      return undefined
    }

    const lines: string[] = []
    for (const entry of namespaceTags) {
      const line = tagLine(entry)
      if (line) lines.push(line)
    }

    if (lines.length === 0) return undefined

    const commentBody = lines.join('\\n')
    const targetStr = commentTarget(target, objectName, columnName)
    const sql: SqlOutput[] = [{ sql: `COMMENT ON ${targetStr} IS E'${commentBody}';` }]

    // Build docs column entry
    const label = buildGraphqlLabel(namespaceTags)
    const docTarget = target === 'column' ? { object: objectName, column: columnName } : { object: objectName }

    return {
      sql,
      docs: label
        ? {
            columns: [{ header: 'GraphQL', ...docTarget, value: label }],
          }
        : undefined,
    }
  },
}

export default plugin
