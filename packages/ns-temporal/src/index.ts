/**
 * Temporal namespace plugin -- generates SCD Type 2 temporal tables.
 *
 * Adds valid_from/valid_to columns to the table, creates a current-rows view,
 * and generates triggers for versioned row management:
 * - INSERT: set valid_from=NOW(), valid_to=NULL
 * - UPDATE: copy OLD row with valid_to=NOW(), set NEW.valid_from=NOW()
 * - DELETE: archive the row (insert copy with valid_to=NOW()), then allow the delete to proceed
 *
 * Postgres: PL/pgSQL BEFORE trigger functions.
 * MySQL: Limited support — DDL + view + INSERT trigger only (self-referential triggers not supported).
 */

import {
  type Column,
  createRequireTableTagLintRule,
  currentTimestamp,
  type Dialect,
  defineNamespace,
  getPrimaryKeyColumns,
  getSchemaColumns,
  getSchemaTable,
  quoteIdentifier,
  type SqlOutput,
  type TagContext,
  type TagOutput,
  timestampType,
} from '@sqldoc/core'

// -- Helper functions --

/** Generate ALTER TABLE statements to add temporal columns and update PK to composite */
function generateTemporalColumnsSql(
  objectName: string,
  dialect: Dialect,
  pkColumns: string[] | undefined,
): SqlOutput[] {
  const q = (name: string) => quoteIdentifier(name, dialect)
  const ts = timestampType(dialect)
  const now = currentTimestamp(dialect)

  const sqls: SqlOutput[] = [
    { sql: `ALTER TABLE ${q(objectName)} ADD COLUMN ${q('valid_from')} ${ts} NOT NULL DEFAULT ${now};` },
    { sql: `ALTER TABLE ${q(objectName)} ADD COLUMN ${q('valid_to')} ${ts};` },
  ]

  // Add a version_id SERIAL column as new PK so archived rows can coexist with current rows.
  // The original PK columns become a regular unique index on current rows (via the view).
  if (pkColumns && pkColumns.length > 0) {
    if (dialect === 'postgres') {
      const pkeyName = `${objectName}_pkey`
      sqls.push({
        sql: `ALTER TABLE ${q(objectName)} DROP CONSTRAINT ${q(pkeyName)};`,
      })
      sqls.push({
        sql: `ALTER TABLE ${q(objectName)} ADD COLUMN ${q('version_id')} BIGSERIAL PRIMARY KEY;`,
      })
    } else {
      // MySQL: can't reliably alter AUTO_INCREMENT PKs; skip PK alteration
    }
  }

  return sqls
}

/** Generate the current-rows view */
function generateCurrentViewSql(objectName: string, viewName: string, dialect: Dialect): string {
  const q = (name: string) => quoteIdentifier(name, dialect)
  return `CREATE VIEW ${q(viewName)} AS\n  SELECT * FROM ${q(objectName)} WHERE ${q('valid_to')} IS NULL;`
}

/** Generate Postgres PL/pgSQL temporal triggers */
function generatePostgresTriggers(objectName: string, _pkColumns: string[], columns: Column[]): SqlOutput[] {
  const colNames = columns.map((c) => `"${c.name}"`).join(', ')
  const oldRefs = columns.map((c) => `OLD."${c.name}"`).join(', ')

  // INSERT trigger: set valid_from, clear valid_to
  const insertFn = `CREATE OR REPLACE FUNCTION "${objectName}_temporal_insert_fn"() RETURNS TRIGGER AS $$
BEGIN
  NEW."valid_from" = now();
  NEW."valid_to" = NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`

  const insertTrigger = `CREATE TRIGGER "${objectName}_temporal_insert"
  BEFORE INSERT ON "${objectName}"
  FOR EACH ROW
  WHEN (NEW."valid_to" IS NULL)
  EXECUTE FUNCTION "${objectName}_temporal_insert_fn"();`

  // UPDATE trigger: archive OLD row with valid_to set, then update NEW's valid_from
  const updateFn = `CREATE OR REPLACE FUNCTION "${objectName}_temporal_update_fn"() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "${objectName}" (${colNames}, "valid_from", "valid_to")
  VALUES (${oldRefs}, OLD."valid_from", now());
  NEW."valid_from" = now();
  NEW."valid_to" = NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`

  const updateTrigger = `CREATE TRIGGER "${objectName}_temporal_update"
  BEFORE UPDATE ON "${objectName}"
  FOR EACH ROW
  WHEN (OLD."valid_to" IS NULL)
  EXECUTE FUNCTION "${objectName}_temporal_update_fn"();`

  // DELETE trigger: archive the row being deleted, then let DELETE proceed
  const deleteFn = `CREATE OR REPLACE FUNCTION "${objectName}_temporal_delete_fn"() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "${objectName}" (${colNames}, "valid_from", "valid_to")
  VALUES (${oldRefs}, OLD."valid_from", now());
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;`

  const deleteTrigger = `CREATE TRIGGER "${objectName}_temporal_delete"
  BEFORE DELETE ON "${objectName}"
  FOR EACH ROW
  WHEN (OLD."valid_to" IS NULL)
  EXECUTE FUNCTION "${objectName}_temporal_delete_fn"();`

  return [
    { sql: insertFn },
    { sql: insertTrigger },
    { sql: updateFn },
    { sql: updateTrigger },
    { sql: deleteFn },
    { sql: deleteTrigger },
  ]
}

/** Generate MySQL temporal triggers (limited — only INSERT defaults) */
function generateMysqlTriggers(objectName: string): SqlOutput[] {
  const q = (name: string) => quoteIdentifier(name, 'mysql')

  // MySQL cannot do self-referential INSERT/UPDATE in triggers
  // Only provide INSERT trigger for setting defaults
  const triggerName = `${objectName}_temporal_insert`
  const insertTrigger = `CREATE TRIGGER ${q(triggerName)}
  BEFORE INSERT ON ${q(objectName)}
  FOR EACH ROW
BEGIN
  SET NEW.${q('valid_from')} = NOW();
  SET NEW.${q('valid_to')} = NULL;
END;`

  return [{ sql: insertTrigger }]
}

// -- Handler --

function handleTemporal(ctx: TagContext): TagOutput {
  const { objectName, dialect, tag } = ctx
  const args = tag.args as Record<string, unknown>
  const viewName = (args.view as string) || (ctx.config.view as string) || `${objectName}_current`

  const table = getSchemaTable(ctx)
  const pkColumns = getPrimaryKeyColumns(table)
  const columns = getSchemaColumns(table)

  const columnSqls = generateTemporalColumnsSql(objectName, dialect, pkColumns)
  const viewSql: SqlOutput = { sql: generateCurrentViewSql(objectName, viewName, dialect) }

  const extraAnnotations: Array<{ object: string; text: string }> = []
  let triggerSqls: SqlOutput[]

  if (dialect === 'mysql') {
    triggerSqls = generateMysqlTriggers(objectName)
    extraAnnotations.push({
      object: objectName,
      text: 'MySQL does not support self-referential triggers for UPDATE/DELETE temporal behavior. Use application-level logic.',
    })
  } else if (pkColumns.length === 0 || columns.length === 0) {
    triggerSqls = []
    extraAnnotations.push({
      object: objectName,
      text: 'Temporal triggers require Tier 2 compilation (PK columns needed for trigger generation)',
    })
  } else {
    triggerSqls = generatePostgresTriggers(objectName, pkColumns, columns)
  }

  return {
    sql: [...columnSqls, viewSql, ...triggerSqls],
    docs: {
      relationships: [{ from: objectName, to: viewName, label: 'current view', style: 'dashed' }],
      annotations: [{ object: objectName, text: 'Temporal (SCD Type 2)' }, ...extraAnnotations],
      columns: [{ header: 'Temporal', object: objectName, value: 'valid_from / valid_to' }],
    },
  }
}

// -- Plugin definition --

const plugin = defineNamespace({
  name: 'temporal',
  description: 'Temporal tables with current-row views and versioning triggers',
  engines: ['postgres', 'mysql'],
  tags: {
    $self: {
      description: 'Make this table temporal with valid_from/valid_to versioning (SCD Type 2)',
      targets: ['table'],
      args: {
        view: { type: 'string' },
      },
    },
  },
  handlers: {
    $self: handleTemporal,
  },
  examples: [
    {
      title: 'Version rows over time',
      description: 'Adds validity columns, a current-row view, and trigger-based versioning.',
      engine: 'postgres',
      input: `-- @temporal(view: 'accounts_current')
CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL
);`,
    },
  ],
  lintRules: [
    createRequireTableTagLintRule('temporal', {
      description: 'Tables should have a @temporal tag',
    }),
  ],
})

export default plugin
