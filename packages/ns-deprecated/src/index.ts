import { defineNamespace, escapeString, quoteIdentifier, type TagContext, type TagOutput } from '@sqldoc/core'

function emitDeprecated(kind: '$self' | 'replace' | 'remove', ctx: TagContext): TagOutput | undefined {
  const { target, objectName, columnName, dialect } = ctx
  const q = (name: string) => quoteIdentifier(name, dialect)
  const esc = (s: string) => escapeString(s, dialect)

  const docTarget = target === 'column' ? { object: objectName, column: columnName } : { object: objectName }

  let message: string
  let docsValue: string
  switch (kind) {
    case '$self':
      message = 'DEPRECATED'
      docsValue = 'Deprecated'
      break
    case 'replace': {
      const args = ctx.tag.args as unknown[]
      const newName = args[0] as string
      message = `DEPRECATED: use ${newName} instead`
      docsValue = `Deprecated → ${newName}`
      break
    }
    case 'remove': {
      const args = ctx.tag.args as unknown[]
      const date = args[0] as string
      message = `DEPRECATED: scheduled for removal after ${date}`
      docsValue = `Remove after ${date}`
      break
    }
  }

  const docs = {
    columns: [{ header: 'Status', ...docTarget, value: docsValue }],
  }

  switch (dialect) {
    case 'postgres': {
      const keyword = target.toUpperCase()
      const name = target === 'column' ? `${q(objectName)}.${q(columnName!)}` : q(objectName)
      return {
        sql: [{ sql: `COMMENT ON ${keyword} ${name} IS ${esc(message)};` }],
        docs,
      }
    }
    case 'mysql':
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
            { sql: `ALTER TABLE ${q(objectName)} MODIFY COLUMN ${q(columnName!)} ${colType} COMMENT ${esc(message)};` },
          ],
          docs,
        }
      }
      return { sql: [], docs }
    case 'sqlite':
      return { sql: [], docs }
  }
}

const plugin = defineNamespace({
  name: 'deprecated',
  databases: ['postgres', 'mysql', 'sqlite'],
  description: 'Marks schema objects as deprecated in SQL comments and generated docs',
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
  handlers: {
    $self: (ctx) => emitDeprecated('$self', ctx),
    replace: (ctx) => emitDeprecated('replace', ctx),
    remove: (ctx) => emitDeprecated('remove', ctx),
  },
  examples: [
    {
      title: 'Deprecate a legacy table',
      description: 'Adds comment metadata and docs status markers.',
      engine: 'postgres',
      input: `-- @deprecated.replace('user_profiles')
CREATE TABLE user_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL
);`,
      output: `COMMENT ON TABLE "user_settings" IS 'DEPRECATED: use user_profiles instead';`,
    },
  ],
})

export default plugin
