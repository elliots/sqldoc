import type { NamespacePlugin, TagContext, TagOutput } from '@sqldoc/core'

const plugin: NamespacePlugin = {
  apiVersion: 1,
  databases: ['postgres'],
  description: 'PostgreSQL Anonymizer security labels',
  name: 'anon',
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

  onTag(ctx: TagContext): TagOutput | undefined {
    const { tag, objectName, columnName } = ctx

    switch (tag.name) {
      case 'mask': {
        if (!columnName) return undefined
        const fnExpr = Array.isArray(tag.args) ? tag.args[0] : undefined
        if (!fnExpr) return undefined
        return {
          sql: [
            {
              sql: `SECURITY LABEL FOR anon ON COLUMN "${objectName}"."${columnName}" IS 'MASKED WITH FUNCTION ${fnExpr}';`,
            },
          ],
          docs: {
            columns: [{ header: 'Anonymization', object: objectName, column: columnName, value: `Masked: ${fnExpr}` }],
          },
        }
      }
      case 'fake': {
        if (!columnName) return undefined
        const fnExpr = Array.isArray(tag.args) ? tag.args[0] : undefined
        if (!fnExpr) return undefined
        return {
          sql: [
            {
              sql: `SECURITY LABEL FOR anon ON COLUMN "${objectName}"."${columnName}" IS 'MASKED WITH FUNCTION ${fnExpr}';`,
            },
          ],
          docs: {
            columns: [{ header: 'Anonymization', object: objectName, column: columnName, value: `Fake: ${fnExpr}` }],
          },
        }
      }
      default:
        return undefined
    }
  },
}

export default plugin
