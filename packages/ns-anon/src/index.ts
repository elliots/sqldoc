import { defineNamespace, escapeString, quoteIdentifier, type TagContext, type TagOutput } from '@sqldoc/core'

function handleAnonColumn(mode: 'Masked' | 'Fake', ctx: TagContext): TagOutput | undefined {
  const { tag, objectName, columnName, dialect } = ctx
  if (!columnName) return undefined

  const fnExpr = Array.isArray(tag.args) ? tag.args[0] : undefined
  if (!fnExpr) return undefined

  const quotedObject = quoteIdentifier(objectName, dialect)
  const quotedColumn = quoteIdentifier(columnName, dialect)
  const escapedLabel = escapeString(`MASKED WITH FUNCTION ${fnExpr}`, dialect)

  return {
    sql: [
      {
        sql: `SECURITY LABEL FOR anon ON COLUMN ${quotedObject}.${quotedColumn} IS ${escapedLabel};`,
      },
    ],
    docs: {
      columns: [{ header: 'Anonymization', object: objectName, column: columnName, value: `${mode}: ${fnExpr}` }],
    },
  }
}

const plugin = defineNamespace({
  name: 'anon',
  engines: ['postgres'],
  description: 'PostgreSQL Anonymizer security labels',
  tags: {
    mask: {
      description: 'Mask this column using a PostgreSQL Anonymizer function',
      targets: ['column'],
      args: [{ type: 'string' }],
    },
    fake: {
      description: 'Generate fake data for this column using a PostgreSQL Anonymizer function',
      targets: ['column'],
      args: [{ type: 'string' }],
    },
    $self: {
      description: 'Mark this table as containing anonymizable data',
      targets: ['table'],
    },
  },
  handlers: {
    mask: (ctx) => handleAnonColumn('Masked', ctx),
    fake: (ctx) => handleAnonColumn('Fake', ctx),
  },
  examples: [
    {
      title: 'Mask personally identifiable information',
      description: 'Adds PostgreSQL Anonymizer security labels to sensitive columns.',
      engine: 'postgres',
      input: `-- @anon
CREATE TABLE patients (
  id SERIAL PRIMARY KEY,
  -- @anon.mask('anon.partial(email, 2, $$***$$, 2)')
  email TEXT NOT NULL,
  -- @anon.fake('anon.fake_last_name()')
  last_name TEXT NOT NULL
);`,
      output: `SECURITY LABEL FOR anon ON COLUMN "patients"."email" IS 'MASKED WITH FUNCTION anon.partial(email, 2, $$***$$, 2)';
SECURITY LABEL FOR anon ON COLUMN "patients"."last_name" IS 'MASKED WITH FUNCTION anon.fake_last_name()';`,
    },
  ],
})

export default plugin
