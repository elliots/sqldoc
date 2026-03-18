import type { NamespacePlugin, SqlOutput, TagContext, TagOutput } from '@sqldoc/core'

const plugin: NamespacePlugin = {
  apiVersion: 1,
  name: 'audit',
  tags: {
    $self: {
      description: 'Enable audit logging on this table',
      targets: ['table'],
      args: {
        on: { type: 'array', items: { type: 'enum', values: ['insert', 'update', 'delete'] } },
        destination: { type: 'string' },
      },
    },
    redact: {
      description: 'Mark this column for redaction in audit logs',
      targets: ['column'],
      args: {
        strategy: { type: 'enum', values: ['hash', 'mask', 'omit'], required: true },
      },
      validate: (ctx) => {
        // Check the parent table for @audit across the whole file
        const objName = ctx.objectName?.toLowerCase()
        const hasAudit = ctx.fileTags.some(
          (ft) =>
            ft.objectName.toLowerCase() === objName &&
            ft.target === 'table' &&
            ft.tags.some((t) => t.namespace === 'audit' && (t.tag === null || t.tag === '$self')),
        )
        if (!hasAudit) {
          return '@audit.redact requires @audit on the same table'
        }
      },
    },
  },

  onTag(ctx: TagContext): TagOutput | undefined {
    const { tag, objectName } = ctx

    if (tag.name === 'redact') return undefined
    if (tag.name !== '$self' && tag.name !== null) return undefined

    const args = tag.args as Record<string, unknown>
    const operations = (args.on as string[] | undefined) ?? ['insert', 'update', 'delete']
    const destination = (args.destination as string) || (ctx.config.destination as string) || `${objectName}_audit_log`

    const ops = operations.map((op) => op.toUpperCase())
    const triggerEvents = ops.join(' OR ')

    const hasInsert = ops.includes('INSERT')
    const hasDelete = ops.includes('DELETE')

    let oldExpr = 'row_to_json(OLD)'
    let newExpr = 'row_to_json(NEW)'
    let returnExpr = 'RETURN NEW;'

    if (hasInsert && !hasDelete) {
      oldExpr = "CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD) END"
    } else if (hasDelete && !hasInsert) {
      newExpr = "CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW) END"
      returnExpr = "RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;"
    } else if (hasInsert && hasDelete) {
      oldExpr = "CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD) END"
      newExpr = "CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW) END"
      returnExpr = "RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;"
    }

    const tableSql = `CREATE TABLE IF NOT EXISTS "${destination}" (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`

    const fnSql = `CREATE OR REPLACE FUNCTION "${objectName}_audit_fn"() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "${destination}" (table_name, operation, old_data, new_data, changed_at)
  VALUES (TG_TABLE_NAME, TG_OP, ${oldExpr}, ${newExpr}, now());
  ${returnExpr}
END;
$$ LANGUAGE plpgsql;`

    const triggerSql = `CREATE TRIGGER "${objectName}_audit_trigger"
  AFTER ${triggerEvents} ON "${objectName}"
  FOR EACH ROW EXECUTE FUNCTION "${objectName}_audit_fn"();`

    const sql: SqlOutput[] = [{ sql: tableSql }, { sql: fnSql }, { sql: triggerSql }]

    return {
      sql,
      docs: {
        relationships: [
          {
            from: objectName,
            to: destination,
            label: 'audit events',
            style: 'dashed',
          },
        ],
        annotations: [
          {
            object: objectName,
            text: `Audited (${operations.join(', ')})`,
          },
        ],
      },
    }
  },

  lintRules: [
    {
      name: 'audit.require-audit',
      description: 'Tables should have an @audit tag',
      default: 'warn',
      check(ctx) {
        const diagnostics = []
        for (const output of ctx.outputs) {
          // Collect all table-level objects
          const tableObjects = output.fileTags.filter((obj) => obj.target === 'table' && !obj.objectName.includes('.'))

          for (const obj of tableObjects) {
            const hasAudit = obj.tags.some((t) => t.namespace === 'audit' && (t.tag === null || t.tag === '$self'))
            if (!hasAudit) {
              diagnostics.push({
                objectName: obj.objectName,
                sourceFile: output.sourceFile,
                message: `Table '${obj.objectName}' has no @audit tag`,
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
