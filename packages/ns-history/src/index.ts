/**
 * History namespace plugin -- generates history tables and triggers for change tracking.
 *
 * Creates a {table}_history table mirroring the source table's columns plus history metadata
 * (history_id, valid_from, valid_to, history_operation). BEFORE UPDATE/DELETE triggers copy
 * the OLD row into the history table.
 *
 * Postgres: PL/pgSQL function + multi-event BEFORE trigger.
 * MySQL: Separate per-event BEFORE triggers with explicit column enumeration.
 * SQLite: Separate per-event BEFORE triggers with explicit column enumeration.
 */

import type { NamespacePlugin, SqlOutput, TagContext, TagOutput } from '@sqldoc/core'
import { autoIncrementType, currentTimestamp, type Dialect, quoteIdentifier, timestampType } from '@sqldoc/core'

// -- Minimal Atlas type shapes --

interface HistoryColumn {
  name: string
  type?: { T?: string; raw?: string; null?: boolean }
}

interface HistoryTable {
  name: string
  columns?: HistoryColumn[]
}

// -- Helper functions --

/** Get the raw SQL type string from an Atlas column type */
function columnTypeSql(col: HistoryColumn): string {
  return col.type?.raw ?? col.type?.T ?? 'TEXT'
}

/** Generate the history table DDL mirroring source columns + metadata */
function generateHistoryTableSql(destination: string, columns: HistoryColumn[], dialect: Dialect): string {
  const q = (name: string) => quoteIdentifier(name, dialect)
  const colDefs = columns.map((col) => {
    const nullable = col.type?.null !== false ? '' : ' NOT NULL'
    return `  ${q(col.name)} ${columnTypeSql(col)}${nullable}`
  })

  // SQLite requires parentheses around expression defaults: DEFAULT (datetime('now'))
  const defaultExpr = dialect === 'sqlite' ? `(${currentTimestamp(dialect)})` : currentTimestamp(dialect)

  return `CREATE TABLE IF NOT EXISTS ${q(destination)} (
  history_id ${autoIncrementType('bigint', dialect)} PRIMARY KEY,
${colDefs.join(',\n')},
  valid_from ${timestampType(dialect)} NOT NULL DEFAULT ${defaultExpr},
  valid_to ${timestampType(dialect)},
  history_operation TEXT NOT NULL
);`
}

/** Generate Postgres PL/pgSQL function + multi-event BEFORE trigger */
function generatePostgresHistoryTriggers(
  objectName: string,
  destination: string,
  operations: string[],
  columns: HistoryColumn[],
): SqlOutput[] {
  const ops = operations.map((op) => op.toUpperCase())
  const triggerEvents = ops.join(' OR ')
  const colNames = columns.map((c) => `"${c.name}"`).join(', ')
  const oldRefs = columns.map((c) => `OLD."${c.name}"`).join(', ')

  const fnSql = `CREATE OR REPLACE FUNCTION "${objectName}_history_fn"() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "${destination}" (${colNames}, valid_from, valid_to, history_operation)
  VALUES (${oldRefs}, now(), now(), TG_OP);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`

  const triggerSql = `CREATE TRIGGER "${objectName}_history_trigger"
  BEFORE ${triggerEvents} ON "${objectName}"
  FOR EACH ROW EXECUTE FUNCTION "${objectName}_history_fn"();`

  return [{ sql: fnSql }, { sql: triggerSql }]
}

/** Generate separate per-event BEFORE triggers for MySQL/SQLite */
function generatePerEventHistoryTriggers(
  objectName: string,
  destination: string,
  operations: string[],
  columns: HistoryColumn[],
  dialect: Dialect,
): SqlOutput[] {
  const q = (name: string) => quoteIdentifier(name, dialect)
  const ts = currentTimestamp(dialect)
  const outputs: SqlOutput[] = []

  const colNames = columns.map((c) => q(c.name)).join(', ')

  for (const op of operations) {
    const opLower = op.toLowerCase()
    const opUpper = op.toUpperCase()
    const triggerName = `${objectName}_history_before_${opLower}`

    // BEFORE triggers always have OLD
    const oldRefs = columns.map((c) => `OLD.${q(c.name)}`).join(', ')

    outputs.push({
      sql: `CREATE TRIGGER ${q(triggerName)}
  BEFORE ${opUpper} ON ${q(objectName)}
  FOR EACH ROW
BEGIN
  INSERT INTO ${q(destination)} (${colNames}, valid_from, valid_to, history_operation)
  VALUES (${oldRefs}, ${ts}, ${ts}, '${opUpper}');
END;`,
    })
  }

  return outputs
}

// -- Plugin definition --

const plugin: NamespacePlugin = {
  apiVersion: 1,
  name: 'history',
  tags: {
    $self: {
      description: 'Enable history tracking on this table (creates history table + triggers)',
      targets: ['table'],
      args: {
        destination: { type: 'string' },
        on: { type: 'array', items: { type: 'enum', values: ['update', 'delete'] } },
      },
    },
  },

  onTag(ctx: TagContext): TagOutput | undefined {
    const { tag, objectName } = ctx
    const dialect = ctx.dialect

    if (tag.name !== '$self' && tag.name !== null) return undefined

    const args = tag.args as Record<string, unknown>
    const operations = (args.on as string[] | undefined) ?? ['update', 'delete']
    const destination = (args.destination as string) || (ctx.config.destination as string) || `${objectName}_history`

    // History table requires column info from Atlas for ALL dialects
    const table = ctx.atlasTable as HistoryTable | undefined
    const columns = table?.columns

    if (!columns || columns.length === 0) {
      return {
        sql: [],
        docs: {
          relationships: [
            {
              from: objectName,
              to: destination,
              label: 'history',
              style: 'dashed',
            },
          ],
          annotations: [
            {
              object: objectName,
              text: 'History triggers require Tier 2 compilation (column enumeration needed for history table DDL)',
            },
          ],
        },
      }
    }

    // History table DDL
    const historyTableSql: SqlOutput = { sql: generateHistoryTableSql(destination, columns, dialect) }

    // Trigger generation
    let triggerSqls: SqlOutput[]

    if (dialect === 'postgres') {
      triggerSqls = generatePostgresHistoryTriggers(objectName, destination, operations, columns)
    } else if (dialect === 'mssql') {
      // MSSQL: trigger generation not yet implemented
      triggerSqls = []
    } else if (dialect === 'mysql' || dialect === 'sqlite') {
      triggerSqls = generatePerEventHistoryTriggers(objectName, destination, operations, columns, dialect)
    } else {
      throw new Error(`ns-history: unsupported dialect '${dialect}'`)
    }

    const sql: SqlOutput[] = [historyTableSql, ...triggerSqls]

    return {
      sql,
      docs: {
        relationships: [
          {
            from: objectName,
            to: destination,
            label: 'history',
            style: 'dashed',
          },
        ],
        annotations: [
          {
            object: objectName,
            text: `History tracked (${operations.join(', ')})`,
          },
        ],
      },
    }
  },

  lintRules: [
    {
      name: 'history.require-history',
      description: 'Tables should have a @history tag',
      default: 'warn',

      check(ctx) {
        const diagnostics = []
        for (const output of ctx.outputs) {
          const tableObjects = output.fileTags.filter((obj) => obj.target === 'table' && !obj.objectName.includes('.'))

          for (const obj of tableObjects) {
            const hasHistory = obj.tags.some((t) => t.namespace === 'history' && (t.tag === null || t.tag === '$self'))
            if (!hasHistory) {
              diagnostics.push({
                objectName: obj.objectName,
                sourceFile: output.sourceFile,
                message: `Table '${obj.objectName}' has no @history tag`,
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
