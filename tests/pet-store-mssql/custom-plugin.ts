import type { NamespacePlugin } from '@sqldoc/core'

/**
 * Custom local namespace plugin for pet-store integration test.
 *
 * Adds an `updated_by` column via ALTER TABLE to any table tagged with `@custom`.
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
  databases: ['postgres', 'mysql', 'sqlite', 'mssql'],

  onTag(ctx: { tag: { name: string | null }; objectName: string; dialect: string }) {
    if (ctx.tag.name !== '$self' && ctx.tag.name !== null) return undefined

    const q =
      ctx.dialect === 'mysql'
        ? (n: string) => `\`${n}\``
        : ctx.dialect === 'mssql'
          ? (n: string) => `[${n}]`
          : (n: string) => `"${n}"`

    const textType = ctx.dialect === 'mssql' ? 'NVARCHAR(MAX)' : 'TEXT'

    return {
      sql: [
        {
          sql: `ALTER TABLE ${q(ctx.objectName)} ADD ${q('updated_by')} ${textType};`,
        },
      ],
    }
  },
}

export default plugin
