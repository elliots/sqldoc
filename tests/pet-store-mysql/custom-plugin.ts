import type { NamespacePlugin } from '@sqldoc/core'

/**
 * Custom local namespace plugin for pet-store integration test.
 *
 * Adds an `updated_by TEXT` column via ALTER TABLE to any table tagged with `@custom`.
 * Exercises the local plugin import path (`@import './custom-plugin.ts'`).
 */

const plugin: NamespacePlugin = {
  apiVersion: 1 as const,
  name: 'custom',
  tags: {
    $self: {
      description: 'Add an updated_by tracking column to this table',
      targets: ['table'] as const,
    },
  },
  databases: ['postgres', 'mysql', 'sqlite'],

  onTag(ctx: { tag: { name: string | null }; objectName: string; dialect: string }) {
    if (ctx.tag.name !== '$self' && ctx.tag.name !== null) return undefined

    const q = ctx.dialect === 'mysql' ? (n: string) => `\`${n}\`` : (n: string) => `"${n}"`

    return {
      sql: [
        {
          sql: `ALTER TABLE ${q(ctx.objectName)} ADD COLUMN ${q('updated_by')} TEXT;`,
        },
      ],
    }
  },
}

export default plugin
