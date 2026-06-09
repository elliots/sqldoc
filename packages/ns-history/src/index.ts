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

import {
  autoIncrementType,
  type Column,
  createRequireTableTagLintRule,
  currentTimestamp,
  type Dialect,
  defineNamespace,
  getSchemaColumns,
  getSchemaTable,
  quoteIdentifier,
  type SqlOutput,
  type TagContext,
  type TagOutput,
  timestampType,
} from '@sqldoc/core'

// -- Helper functions --

/** Get the raw SQL type string from an inspected column type */
function columnTypeSql(col: Column): string {
  return col.type.raw ?? col.type.type.T ?? 'TEXT'
}

/** Generate the history table DDL mirroring source columns + metadata */
function generateHistoryTableSql(destination: string, columns: Column[], dialect: Dialect): string {
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
  columns: Column[],
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
  columns: Column[],
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

/** Generate separate per-event triggers for MSSQL using the deleted pseudo-table. */
function generateMssqlHistoryTriggers(
  objectName: string,
  destination: string,
  operations: string[],
  columns: Column[],
): SqlOutput[] {
  const q = (name: string) => quoteIdentifier(name, 'mssql')
  const outputs: SqlOutput[] = []
  const colNames = columns.map((c) => q(c.name)).join(', ')
  const oldRefs = columns.map((c) => `d.${q(c.name)}`).join(', ')

  for (const op of operations) {
    const opLower = op.toLowerCase()
    const opUpper = op.toUpperCase()
    const triggerName = `${objectName}_history_after_${opLower}`

    outputs.push({
      sql: `CREATE TRIGGER ${q(triggerName)}
ON ${q(objectName)}
AFTER ${opUpper}
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO ${q(destination)} (${colNames}, valid_from, valid_to, history_operation)
  SELECT ${oldRefs}, SYSUTCDATETIME(), SYSUTCDATETIME(), '${opUpper}'
  FROM deleted d;
END;`,
    })
  }

  return outputs
}

// -- Handler --

function handleHistory(ctx: TagContext): TagOutput {
  const { objectName, dialect, tag } = ctx
  const args = tag.args as Record<string, unknown>
  const operations = (args.on as string[] | undefined) ?? ['update', 'delete']
  const destination = (args.destination as string) || (ctx.config.destination as string) || `${objectName}_history`

  const relationship = {
    from: objectName,
    to: destination,
    label: 'history',
    style: 'dashed' as const,
  }

  const columns = getSchemaColumns(getSchemaTable(ctx))
  if (columns.length === 0) {
    return {
      sql: [],
      docs: {
        relationships: [relationship],
        annotations: [
          {
            object: objectName,
            text: 'History triggers require Tier 2 compilation (column enumeration needed for history table DDL)',
          },
        ],
      },
    }
  }

  const triggerSqls =
    dialect === 'postgres'
      ? generatePostgresHistoryTriggers(objectName, destination, operations, columns)
      : dialect === 'mysql' || dialect === 'sqlite'
        ? generatePerEventHistoryTriggers(objectName, destination, operations, columns, dialect)
        : dialect === 'mssql'
          ? generateMssqlHistoryTriggers(objectName, destination, operations, columns)
          : (() => {
              throw new Error(`ns-history: unsupported dialect '${dialect}'`)
            })()

  return {
    sql: [{ sql: generateHistoryTableSql(destination, columns, dialect) }, ...triggerSqls],
    docs: {
      relationships: [relationship],
      annotations: [{ object: objectName, text: `History tracked (${operations.join(', ')})` }],
    },
  }
}

// -- Plugin definition --

const plugin = defineNamespace({
  name: 'history',
  description: 'History tables and change-tracking triggers for update/delete workflows',
  engines: ['postgres', 'mysql', 'sqlite', 'mssql', 'azuresql'],
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
  handlers: {
    $self: handleHistory,
  },
  examples: [
    {
      title: 'Track row history',
      description: 'Creates a mirrored history table and before triggers for updates and deletes.',
      engine: 'postgres',
      input: `-- @history
CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  status TEXT NOT NULL
);`,
    },
  ],
  lintRules: [
    createRequireTableTagLintRule('history', {
      description: 'Tables should have a @history tag',
    }),
  ],
})

export default plugin
