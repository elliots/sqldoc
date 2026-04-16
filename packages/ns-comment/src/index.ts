import { defineNamespace, escapeString, quoteIdentifier, type SqlOutput, type TagContext } from '@sqldoc/core'

function handleComment(ctx: TagContext): SqlOutput[] | undefined {
  const { tag, target, objectName, columnName, dialect } = ctx
  const args = tag.args as unknown[]
  const description = args[0] as string | undefined
  if (!description) return undefined

  const q = (name: string) => quoteIdentifier(name, dialect)
  const esc = (s: string) => escapeString(s, dialect)

  switch (dialect) {
    case 'postgres': {
      switch (target) {
        case 'column':
          if (!columnName) return undefined
          return [{ sql: `COMMENT ON COLUMN ${q(objectName)}.${q(columnName)} IS ${esc(description)};` }]
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
    case 'mysql':
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
      return undefined
    case 'sqlite':
      return undefined
  }
}

const plugin = defineNamespace({
  name: 'comment',
  databases: ['postgres', 'mysql', 'sqlite'],
  description: 'Dialect-aware SQL comments for tables, columns, and other schema objects',
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
  handlers: {
    $self: handleComment,
  },
  examples: [
    {
      title: 'Describe a table and column',
      description: 'Emits dialect-specific comment statements.',
      engine: 'postgres',
      input: `-- @comment('Primary user accounts table')
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  -- @comment('User email address, must be unique')
  email TEXT NOT NULL UNIQUE
);`,
      output: `COMMENT ON TABLE "users" IS 'Primary user accounts table';
COMMENT ON COLUMN "users"."email" IS 'User email address, must be unique';`,
    },
  ],
})

export default plugin
