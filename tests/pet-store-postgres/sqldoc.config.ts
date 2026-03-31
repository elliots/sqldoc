export default {
  dialect: 'postgres' as const,
  schema: 'schema.sql',
  migrations: {
    dir: 'migrations',
  },
  namespaces: {
    docs: {
      format: 'html',
      output: 'docs/schema.html',
    },
    codegen: {
      templates: [{ template: '@sqldoc/templates/typescript', output: 'generated/types.ts' }],
    },
  },
}
