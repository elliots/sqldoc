import {
  createRequireTableTagLintRule,
  defineNamespace,
  requireNamespaceOnSameObject,
  type TagContext,
  type TagOutput,
} from '@sqldoc/core'

function handleEnableRls(ctx: TagContext): TagOutput {
  return {
    sql: [{ sql: `ALTER TABLE "${ctx.objectName}" ENABLE ROW LEVEL SECURITY;` }],
    docs: {
      annotations: [
        {
          object: ctx.objectName,
          text: 'RLS enabled',
        },
      ],
    },
  }
}

function handlePolicy(ctx: TagContext): TagOutput {
  const args = ctx.tag.args as Record<string, unknown>
  const forCmd = (args.for as string) || 'ALL'
  const toRole = (args.to as string) || 'PUBLIC'
  const using = args.using as string | undefined
  const check = args.check as string | undefined
  const policyName = `${ctx.objectName}_${toRole.toLowerCase().replace(/\s+/g, '_')}_${forCmd.toLowerCase()}`

  let policySql = `CREATE POLICY "${policyName}" ON "${ctx.objectName}"\n  FOR ${forCmd.toUpperCase()}\n  TO ${toRole}`
  if (using) policySql += `\n  USING (${using})`
  if (check) policySql += `\n  WITH CHECK (${check})`
  policySql += ';'

  return { sql: [{ sql: policySql }] }
}

const plugin = defineNamespace({
  name: 'rls',
  engines: ['postgres'],
  description: 'Row-level security policies for PostgreSQL tables',
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
      validate: requireNamespaceOnSameObject('rls', '@rls.policy requires @rls on the same table'),
    },
    $self: {
      description: 'Enable row-level security on this table',
      targets: ['table'],
    },
  },
  handlers: {
    $self: handleEnableRls,
    policy: handlePolicy,
  },
  lintRules: [
    createRequireTableTagLintRule('rls', {
      ruleName: 'rls.require-policy',
      description: 'Public tables should have RLS enabled',
      message: (objectName) => `Table '${objectName}' has no RLS policy`,
      supportedEngines: ['postgres'],
    }),
  ],
  examples: [
    {
      title: 'Enable RLS and add a policy',
      description: 'Use `@rls` plus one or more `@rls.policy` tags on the table.',
      engine: 'postgres',
      input: `-- @rls
-- @rls.policy(for: SELECT, to: authenticated, using: 'user_id = current_user_id()')
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL
);`,
      output: `ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documents_authenticated_select" ON "documents"
  FOR SELECT
  TO authenticated
  USING (user_id = current_user_id());`,
    },
  ],
})

export default plugin
