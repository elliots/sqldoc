export default {
  engine: 'sqlite' as const,
  schema: 'schema.sql',
  migrations: {
    dir: 'migrations',
  },
  namespaces: {
    codegen: {
      templates: [{ template: '@sqldoc/templates/typescript', output: 'generated/types.ts' }],
    },
  },
}
