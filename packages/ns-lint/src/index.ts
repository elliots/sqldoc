import { defineNamespace } from '@sqldoc/core'

const plugin = defineNamespace({
  name: 'lint',
  description: 'Tag-level lint suppressions for sqldoc rules',
  tags: {
    ignore: {
      description: 'Suppress a lint rule on this object. Reason is mandatory.',
      targets: ['table', 'column', 'view', 'function'],
      args: [{ type: 'string' }, { type: 'string' }],
    },
  },
  examples: [
    {
      title: 'Suppress a lint rule',
      description: 'Use this when an exception is intentional and documented.',
      dialect: 'postgres',
      input: `-- @lint.ignore('audit.require-audit', 'Temporary staging table')
CREATE TABLE temp_imports (
  id SERIAL PRIMARY KEY,
  payload JSONB NOT NULL
);`,
    },
  ],
})

export default plugin
