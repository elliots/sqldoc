export default {
  dialect: 'mssql' as const,
  schema: 'schema.sql',
  devUrl: 'docker://mcr.microsoft.com/mssql/server:2022-latest',
}
