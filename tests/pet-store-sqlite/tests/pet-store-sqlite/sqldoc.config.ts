import type { Config } from './.sqldoc/config'

export default {
  dialect: 'postgres',
  schema: 'schema/',
  migrations: {
    dir: 'migrations/',
    format: 'plain',
  },
  namespaces: {
    docs: {
      format: 'html',
      output: 'docs/schema.html',
    },
  },
} satisfies Config
