export default {
  devUrl: 'postgres://postgres:test@localhost:5434/test?sslmode=disable',
  namespaces: {
    docs: {
      format: 'html',
      output: 'docs/schema.html',
      title: 'sqldoc Demo Schema',
    },
  },
}
