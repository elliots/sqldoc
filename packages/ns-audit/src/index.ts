/**
 * Audit namespace plugin -- generates audit triggers for Postgres, MySQL, and SQLite.
 *
 * Postgres: PL/pgSQL trigger function + multi-event trigger with row_to_json.
 * MySQL: Separate per-event triggers with inline bodies using JSON_OBJECT and explicit columns.
 * SQLite: Separate per-event triggers with inline bodies using json_object and explicit columns.
 */

import type { NamespacePlugin, SqlOutput, TagContext, TagOutput } from '@sqldoc/core'
import {
  autoIncrementType,
  type Column,
  currentTimestamp,
  type Dialect,
  getSchemaColumns,
  getSchemaTable,
  jsonObjectFunction,
  jsonType,
  quoteIdentifier,
  timestampType,
} from '@sqldoc/core'

// -- Helper functions --

/** Generate the audit log table DDL with dialect-correct types. */
function generateAuditTableSql(destination: string, dialect: Dialect): string {
  const q = (name: string) => quoteIdentifier(name, dialect)
  const createPrefix =
    dialect === 'mssql'
      ? `IF OBJECT_ID('${destination}', 'U') IS NULL CREATE TABLE ${q(destination)}`
      : `CREATE TABLE IF NOT EXISTS ${q(destination)}`
  const textType = dialect === 'mssql' ? 'NVARCHAR(MAX)' : 'TEXT'
  const defaultTs = dialect === 'sqlite' ? `(${currentTimestamp(dialect)})` : currentTimestamp(dialect)
  return `${createPrefix} (
  id ${autoIncrementType('bigint', dialect)} PRIMARY KEY,
  table_name ${textType} NOT NULL,
  operation ${textType} NOT NULL,
  old_data ${jsonType(dialect)},
  new_data ${jsonType(dialect)},
  changed_at ${timestampType(dialect)} NOT NULL DEFAULT ${defaultTs}
);`
}

/** Build a JSON serialization expression for a row reference (OLD or NEW). */
function generateColumnJsonExpr(ref: 'OLD' | 'NEW', columns: Column[], dialect: Dialect): string {
  const jsonFn = jsonObjectFunction(dialect)
  const pairs = columns.map((c) => `'${c.name}', ${ref}.${quoteIdentifier(c.name, dialect)}`).join(', ')
  return `${jsonFn}(${pairs})`
}

/** Generate separate per-event triggers for MySQL/SQLite (no multi-event, no CREATE FUNCTION). */
function generatePerEventTriggers(
  objectName: string,
  destination: string,
  operations: string[],
  columns: Column[],
  dialect: Dialect,
): SqlOutput[] {
  const q = (name: string) => quoteIdentifier(name, dialect)
  const ts = currentTimestamp(dialect)
  const outputs: SqlOutput[] = []

  for (const op of operations) {
    const opLower = op.toLowerCase()
    const opUpper = op.toUpperCase()
    const triggerName = `${objectName}_audit_after_${opLower}`
    const hasOld = opLower !== 'insert'
    const hasNew = opLower !== 'delete'

    const oldExpr = hasOld ? generateColumnJsonExpr('OLD', columns, dialect) : 'NULL'
    const newExpr = hasNew ? generateColumnJsonExpr('NEW', columns, dialect) : 'NULL'

    outputs.push({
      sql: `CREATE TRIGGER ${q(triggerName)}
  AFTER ${opUpper} ON ${q(objectName)}
  FOR EACH ROW
BEGIN
  INSERT INTO ${q(destination)} (table_name, operation, old_data, new_data, changed_at)
  VALUES ('${objectName}', '${opUpper}', ${oldExpr}, ${newExpr}, ${ts});
END;`,
    })
  }

  return outputs
}

/** Generate Postgres PL/pgSQL function + multi-event trigger (unchanged from original). */
function generatePostgresTriggers(objectName: string, destination: string, operations: string[]): SqlOutput[] {
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

  return [{ sql: fnSql }, { sql: triggerSql }]
}

// -- Plugin definition --

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
    const dialect = ctx.dialect

    if (tag.name === 'redact') return undefined
    if (tag.name !== '$self' && tag.name !== null) return undefined

    const args = tag.args as Record<string, unknown>
    const operations = (args.on as string[] | undefined) ?? ['insert', 'update', 'delete']
    const destination = (args.destination as string) || (ctx.config.destination as string) || `${objectName}_audit_log`

    // Audit log table DDL (dialect-aware types)
    const auditTableSql: SqlOutput = { sql: generateAuditTableSql(destination, dialect) }

    // Trigger generation depends on dialect
    let triggerSqls: SqlOutput[]
    const extraAnnotations: Array<{ object: string; text: string }> = []

    if (dialect === 'postgres') {
      // Postgres: PL/pgSQL function + multi-event trigger
      triggerSqls = generatePostgresTriggers(objectName, destination, operations)
    } else if (dialect === 'mssql') {
      // MSSQL: trigger generation not yet implemented — emit table DDL only
      triggerSqls = []
      extraAnnotations.push({
        object: objectName,
        text: 'MSSQL audit triggers will use inserted/deleted tables (not yet implemented)',
      })
    } else if (dialect === 'mysql' || dialect === 'sqlite') {
      // MySQL/SQLite: need column info from schemaTable for JSON serialization
      const columns = getSchemaColumns(getSchemaTable(ctx))

      if (columns.length === 0) {
        triggerSqls = []
        extraAnnotations.push({
          object: objectName,
          text: 'Audit triggers require Tier 2 compilation for MySQL/SQLite (column enumeration needed for JSON serialization)',
        })
      } else {
        triggerSqls = generatePerEventTriggers(objectName, destination, operations, columns, dialect)
      }
    } else {
      throw new Error(`ns-audit: unsupported dialect '${dialect}'`)
    }

    const sql: SqlOutput[] = [auditTableSql, ...triggerSqls]

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
          ...extraAnnotations,
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
