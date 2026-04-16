import { defineNamespace, type SqlOutput, type TagContext, type TagOutput } from '@sqldoc/core'

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
  switch (entry.tag) {
    case '$self':
    case null:
      return ''
    case 'omit':
      return '@omit'
    case 'omit.operations':
      return `@omit ${((entry.args as Record<string, unknown>).ops as string[]).join(',')}`
    case 'name':
      return `@name ${(entry.args as unknown[])[0]}`
    case 'deprecated': {
      const positional = entry.args as unknown[]
      return `@deprecated ${positional.length > 0 ? positional[0] : 'Deprecated'}`
    }
    case 'simpleCollections':
      return '@simpleCollections only'
    case 'behavior':
      return `@behavior ${(entry.args as unknown[])[0]}`
    default:
      return ''
  }
}

function buildGraphqlLabel(
  namespaceTags: Array<{ tag: string | null; args: Record<string, unknown> | unknown[] }>,
): string | undefined {
  const parts: string[] = []
  for (const entry of namespaceTags) {
    switch (entry.tag) {
      case 'omit':
        parts.push('Omitted')
        break
      case 'omit.operations':
        parts.push(`Omit: ${((entry.args as Record<string, unknown>).ops as string[]).join(', ')}`)
        break
      case 'name':
        parts.push(`→ ${(entry.args as unknown[])[0]}`)
        break
      case 'simpleCollections':
        parts.push('Simple collections')
        break
      case 'behavior':
        parts.push(`Behavior: ${(entry.args as unknown[])[0]}`)
        break
    }
  }
  return parts.length > 0 ? parts.join(', ') : undefined
}

const plugin = defineNamespace({
  name: 'pg',
  engines: ['postgres'],
  description: 'PostGraphile smart comments for PostgreSQL',
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
  examples: [
    {
      title: 'Add PostGraphile smart comments',
      description: 'Multiple `@pg.*` tags on one object are combined into a single smart comment.',
      engine: 'postgres',
      input: `-- @pg.simpleCollections
-- @pg.name('Customer')
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL
);`,
      output: `COMMENT ON TABLE "users" IS E'@simpleCollections only\\n@name Customer';`,
    },
  ],
  onTag(ctx: TagContext): TagOutput | undefined {
    const { tag, objectName, columnName, target, namespaceTags } = ctx

    const firstTag = namespaceTags[0]
    if (firstTag.tag !== tag.name || JSON.stringify(firstTag.args) !== JSON.stringify(tag.args)) {
      return undefined
    }

    const lines = namespaceTags.map((entry) => tagLine(entry)).filter((line) => line.length > 0)
    if (lines.length === 0) return undefined

    const commentBody = lines.join('\\n')
    const targetStr = commentTarget(target, objectName, columnName)
    const sql: SqlOutput[] = [{ sql: `COMMENT ON ${targetStr} IS E'${commentBody}';` }]
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
})

export default plugin
