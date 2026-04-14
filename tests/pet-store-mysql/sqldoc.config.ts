export default {
  engine: 'mysql' as const,
  schema: 'schema.sql',
  devUrl: 'docker://mysql:8',
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
