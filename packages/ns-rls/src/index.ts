import type { NamespacePlugin, TagContext, TagOutput } from '@sqldoc/core'

const plugin: NamespacePlugin = {
  apiVersion: 1,
  databases: ['postgres'],
  description: 'Row-Level Security policies for PostgreSQL',
  name: 'rls',
  tags: {
    policy: {
      description: 'Create a row-level security policy (requires @rls on the table)',
      targets: ['table'],
      args: {
        for: { type: 'string', required: false },
        to: { type: 'string', required: false },
        using: { type: 'string', required: false },
        check: { type: 'string', required: false },
      },
      validate: (ctx) => {
        const hasRlsSelf = ctx.siblingTags.some((t) => t.namespace === 'rls' && (t.tag === null || t.tag === '$self'))
        if (!hasRlsSelf) {
          return '@rls.policy requires @rls on the same table'
        }
      },
    },
    $self: {
      description: 'Enable row-level security on this table',
      targets: ['table'],
    },
  },

  onTag(ctx: TagContext): TagOutput | undefined {
    const { tag, objectName } = ctx

    switch (tag.name) {
      case '$self':
      case null: {
        return {
          sql: [{ sql: `ALTER TABLE "${objectName}" ENABLE ROW LEVEL SECURITY;` }],
          docs: {
            annotations: [
              {
                object: objectName,
                text: 'RLS enabled',
              },
            ],
          },
        }
      }
      case 'policy': {
        const args = tag.args as Record<string, unknown>
        const forCmd = (args.for as string) || 'ALL'
        const toRole = (args.to as string) || 'PUBLIC'
        const using = args.using as string | undefined
        const check = args.check as string | undefined

        const policyName = `${objectName}_${toRole.toLowerCase().replace(/\s+/g, '_')}_${forCmd.toLowerCase()}`

        let policySql = `CREATE POLICY "${policyName}" ON "${objectName}"\n  FOR ${forCmd.toUpperCase()}\n  TO ${toRole}`
        if (using) {
          policySql += `\n  USING (${using})`
        }
        if (check) {
          policySql += `\n  WITH CHECK (${check})`
        }
        policySql += ';'

        return { sql: [{ sql: policySql }] }
      }
      default:
        return undefined
    }
  },

  lintRules: [
    {
      name: 'rls.require-policy',
      description: 'Public tables should have RLS enabled',
      default: 'warn',
      check(ctx) {
        const diagnostics = []
        for (const output of ctx.outputs) {
          // Collect all table-level objects
          const tableObjects = output.fileTags.filter((obj) => obj.target === 'table' && !obj.objectName.includes('.'))

          for (const obj of tableObjects) {
            const hasRls = obj.tags.some((t) => t.namespace === 'rls' && (t.tag === null || t.tag === '$self'))
            if (!hasRls) {
              diagnostics.push({
                objectName: obj.objectName,
                sourceFile: output.sourceFile,
                message: `Table '${obj.objectName}' has no RLS policy`,
              })
            }
          }
        }
        return diagnostics
      },
    },
  ],
}

export default plugin
