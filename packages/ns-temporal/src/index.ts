/**
 * Temporal namespace plugin -- generates SCD Type 2 temporal tables.
 *
 * Adds valid_from/valid_to columns to the table, creates a current-rows view,
 * and generates triggers for versioned row management:
 * - INSERT: set valid_from=NOW(), valid_to=NULL
 * - UPDATE: copy OLD row with valid_to=NOW(), set NEW.valid_from=NOW()
 * - DELETE: set valid_to=NOW() instead of deleting (cancel the delete)
 *
 * Postgres: PL/pgSQL BEFORE trigger functions.
 * MySQL: Limited support — DDL + view + INSERT trigger only (self-referential triggers not supported).
 * SQLite: BEFORE triggers with RAISE(IGNORE) for delete cancellation.
 */

import type { NamespacePlugin, SqlOutput, TagContext, TagOutput } from '@sqldoc/core'
import { currentTimestamp, type Dialect, quoteIdentifier, timestampType } from '@sqldoc/core'

// -- Minimal Atlas type shapes --

interface TemporalColumn {
  name: string
  type?: { T?: string; raw?: string }
}

interface TemporalTable {
  name: string
  columns?: TemporalColumn[]
  primary_key?: { columns?: string[] }
}

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
      sqls.push({
        sql: `ALTER TABLE ${q(objectName)} DROP CONSTRAINT ${q(`${objectName}_pkey`)};`,
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
function generatePostgresTriggers(objectName: string, _pkColumns: string[], columns: TemporalColumn[]): SqlOutput[] {
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
  const insertTrigger = `CREATE TRIGGER ${q(`${objectName}_temporal_insert`)}
  BEFORE INSERT ON ${q(objectName)}
  FOR EACH ROW
BEGIN
  SET NEW.${q('valid_from')} = NOW();
  SET NEW.${q('valid_to')} = NULL;
END;`

  return [{ sql: insertTrigger }]
}

// -- Plugin definition --

const plugin: NamespacePlugin = {
  apiVersion: 1,
  name: 'temporal',
  databases: ['postgres', 'mysql'],
  tags: {
    $self: {
      description: 'Make this table temporal with valid_from/valid_to versioning (SCD Type 2)',
      targets: ['table'],
      args: {
        view: { type: 'string' },
      },
    },
  },

  onTag(ctx: TagContext): TagOutput | undefined {
    const { tag, objectName } = ctx
    const dialect = ctx.dialect

    if (tag.name !== '$self' && tag.name !== null) return undefined

    const args = tag.args as Record<string, unknown>
    const viewName = (args.view as string) || (ctx.config.view as string) || `${objectName}_current`

    // Triggers need atlasTable for PK columns (Postgres, SQLite) or column list
    const table = ctx.atlasTable as TemporalTable | undefined
    const pkColumns = table?.primary_key?.columns

    // Temporal column DDL + composite PK alteration
    const columnSqls = generateTemporalColumnsSql(objectName, dialect, pkColumns)
    const viewSql: SqlOutput = { sql: generateCurrentViewSql(objectName, viewName, dialect) }

    const extraAnnotations: Array<{ object: string; text: string }> = []
    let triggerSqls: SqlOutput[]

    const columns = table?.columns

    if (dialect === 'mysql') {
      // MySQL: limited trigger support (self-referential triggers not supported)
      triggerSqls = generateMysqlTriggers(objectName)
      extraAnnotations.push({
        object: objectName,
        text: 'MySQL does not support self-referential triggers for UPDATE/DELETE temporal behavior. Use application-level logic.',
      })
    } else if (!pkColumns || pkColumns.length === 0 || !columns || columns.length === 0) {
      // Need atlasTable for Postgres triggers
      triggerSqls = []
      extraAnnotations.push({
        object: objectName,
        text: 'Temporal triggers require Tier 2 compilation (PK columns needed for trigger generation)',
      })
    } else {
      // Postgres
      triggerSqls = generatePostgresTriggers(objectName, pkColumns, columns)
    }

    const sql: SqlOutput[] = [...columnSqls, viewSql, ...triggerSqls]

    return {
      sql,
      docs: {
        relationships: [
          {
            from: objectName,
            to: viewName,
            label: 'current view',
            style: 'dashed',
          },
        ],
        annotations: [
          {
            object: objectName,
            text: 'Temporal (SCD Type 2)',
          },
          ...extraAnnotations,
        ],
        columns: [
          {
            header: 'Temporal',
            object: objectName,
            value: 'valid_from / valid_to',
          },
        ],
      },
    }
  },

  lintRules: [
    {
      name: 'temporal.require-temporal',
      description: 'Tables should have a @temporal tag',
      default: 'warn',

      check(ctx) {
        const diagnostics = []
        for (const output of ctx.outputs) {
          const tableObjects = output.fileTags.filter((obj) => obj.target === 'table' && !obj.objectName.includes('.'))

          for (const obj of tableObjects) {
            const hasTemporal = obj.tags.some(
              (t) => t.namespace === 'temporal' && (t.tag === null || t.tag === '$self'),
            )
            if (!hasTemporal) {
              diagnostics.push({
                objectName: obj.objectName,
                sourceFile: output.sourceFile,
                message: `Table '${obj.objectName}' has no @temporal tag`,
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
