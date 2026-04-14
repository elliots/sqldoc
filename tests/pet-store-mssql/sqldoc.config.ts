export default {
  engine: 'mssql' as const,
  schema: 'schema.sql',
  devUrl: 'docker://mcr.microsoft.com/mssql/server:2022-latest',
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
