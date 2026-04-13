/**
 * Soft-delete namespace plugin -- generates deleted_at columns, active views, and cascade triggers.
 *
 * Postgres: ALTER TABLE + CREATE VIEW + PL/pgSQL cascade function + trigger.
 * MySQL: ALTER TABLE + CREATE VIEW + per-event AFTER UPDATE cascade trigger.
 * SQLite: ALTER TABLE + CREATE VIEW + per-event AFTER UPDATE cascade trigger.
 */

import type { NamespacePlugin, SqlOutput, TagContext, TagOutput } from '@sqldoc/core'
import { type Dialect, quoteIdentifier, timestampType } from '@sqldoc/core'

// -- Minimal type shapes for inspected schema objects --

interface SoftDeleteColumn {
  name: string
  type?: { T?: string; raw?: string }
}

interface SoftDeleteForeignKey {
  columns?: string[]
  ref_columns?: string[]
  ref_table?: string
}

interface SoftDeleteTable {
  name: string
  columns?: SoftDeleteColumn[]
  foreign_keys?: SoftDeleteForeignKey[]
  primary_key?: { columns?: string[] }
}

// -- Helper functions --

/** Generate ALTER TABLE to add the deleted_at column */
function generateAddColumnSql(objectName: string, columnName: string, dialect: Dialect): string {
  const q = (name: string) => quoteIdentifier(name, dialect)
  return `ALTER TABLE ${q(objectName)} ADD COLUMN ${q(columnName)} ${timestampType(dialect)};`
}

/** Generate the active view filtering out soft-deleted rows */
function generateActiveViewSql(objectName: string, viewName: string, columnName: string, dialect: Dialect): string {
  const q = (name: string) => quoteIdentifier(name, dialect)
  return `CREATE VIEW ${q(viewName)} AS\n  SELECT * FROM ${q(objectName)} WHERE ${q(columnName)} IS NULL;`
}

/** Generate Postgres cascade function + trigger */
function generatePostgresCascade(
  childTable: string,
  parentTable: string,
  fkColumn: string,
  parentPkColumn: string,
  columnName: string,
): SqlOutput[] {
  const fnName = `${childTable}_${fkColumn}_softdelete_cascade_fn`

  const fnSql = `CREATE OR REPLACE FUNCTION "${fnName}"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."${columnName}" IS NOT NULL AND OLD."${columnName}" IS NULL THEN
    UPDATE "${childTable}" SET "${columnName}" = NEW."${columnName}"
    WHERE "${fkColumn}" = NEW."${parentPkColumn}";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`

  const triggerSql = `CREATE TRIGGER "${childTable}_${fkColumn}_softdelete_cascade_trigger"
  AFTER UPDATE ON "${parentTable}"
  FOR EACH ROW EXECUTE FUNCTION "${fnName}"();`

  return [{ sql: fnSql }, { sql: triggerSql }]
}

/** Generate per-event cascade trigger for MySQL/SQLite */
function generatePerEventCascade(
  childTable: string,
  parentTable: string,
  fkColumn: string,
  parentPkColumn: string,
  columnName: string,
  dialect: Dialect,
): SqlOutput[] {
  const q = (name: string) => quoteIdentifier(name, dialect)
  const triggerName = `${childTable}_${fkColumn}_softdelete_cascade_after_update`

  if (dialect === 'sqlite') {
    // SQLite doesn't support IF...THEN in trigger bodies — use WHEN clause
    return [
      {
        sql: `CREATE TRIGGER ${q(triggerName)}
  AFTER UPDATE ON ${q(parentTable)}
  FOR EACH ROW
  WHEN NEW.${q(columnName)} IS NOT NULL AND OLD.${q(columnName)} IS NULL
BEGIN
  UPDATE ${q(childTable)} SET ${q(columnName)} = NEW.${q(columnName)}
  WHERE ${q(fkColumn)} = NEW.${q(parentPkColumn)};
END;`,
      },
    ]
  }

  // MySQL: procedural IF...THEN in trigger body
  return [
    {
      sql: `CREATE TRIGGER ${q(triggerName)}
  AFTER UPDATE ON ${q(parentTable)}
  FOR EACH ROW
BEGIN
  IF NEW.${q(columnName)} IS NOT NULL AND OLD.${q(columnName)} IS NULL THEN
    UPDATE ${q(childTable)} SET ${q(columnName)} = NEW.${q(columnName)}
    WHERE ${q(fkColumn)} = NEW.${q(parentPkColumn)};
  END IF;
END;`,
    },
  ]
}

// -- Plugin definition --

const plugin: NamespacePlugin = {
  apiVersion: 1,
  name: 'softdelete',
  tags: {
    $self: {
      description: 'Enable soft-delete on this table (adds deleted_at column and active view)',
      targets: ['table'],
      args: {
        column: { type: 'string' },
        view: { type: 'string' },
      },
    },
    cascade: {
      description: 'Cascade soft-delete to this FK column when the parent is soft-deleted',
      targets: ['column'],
      args: {},
      validate: (ctx) => {
        // The column must be on a table that references a parent with @softdelete
        // Basic validation: ensure this table itself has @softdelete
        const objName = ctx.objectName?.toLowerCase()
        const hasSoftDelete = ctx.fileTags.some(
          (ft) =>
            ft.objectName.toLowerCase() === objName &&
            ft.target === 'table' &&
            ft.tags.some((t) => t.namespace === 'softdelete' && (t.tag === null || t.tag === '$self')),
        )
        if (!hasSoftDelete) {
          return '@softdelete.cascade requires @softdelete on the same table'
        }
      },
    },
  },

  onTag(ctx: TagContext): TagOutput | undefined {
    const { tag, objectName } = ctx
    const dialect = ctx.dialect

    if (tag.name === 'cascade') {
      return handleCascade(ctx)
    }

    if (tag.name !== '$self' && tag.name !== null) return undefined

    const args = tag.args as Record<string, unknown>
    const columnName = (args.column as string) || (ctx.config.column as string) || 'deleted_at'
    const viewName = (args.view as string) || (ctx.config.view as string) || `${objectName}_active`

    const sql: SqlOutput[] = [
      { sql: generateAddColumnSql(objectName, columnName, dialect) },
      { sql: generateActiveViewSql(objectName, viewName, columnName, dialect) },
    ]

    return {
      sql,
      docs: {
        relationships: [
          {
            from: objectName,
            to: viewName,
            label: 'active view',
            style: 'dashed',
          },
        ],
        annotations: [
          {
            object: objectName,
            text: `Soft-deletable (${columnName})`,
          },
        ],
      },
    }
  },

  lintRules: [
    {
      name: 'softdelete.require-softdelete',
      description: 'Tables should have a @softdelete tag',
      default: 'warn',

      check(ctx) {
        const diagnostics = []
        for (const output of ctx.outputs) {
          const tableObjects = output.fileTags.filter((obj) => obj.target === 'table' && !obj.objectName.includes('.'))

          for (const obj of tableObjects) {
            const hasSoftDelete = obj.tags.some(
              (t) => t.namespace === 'softdelete' && (t.tag === null || t.tag === '$self'),
            )
            if (!hasSoftDelete) {
              diagnostics.push({
                objectName: obj.objectName,
                sourceFile: output.sourceFile,
                message: `Table '${obj.objectName}' has no @softdelete tag`,
              })
            }
          }
        }
        return diagnostics
      },
    },
  ],
}

function handleCascade(ctx: TagContext): TagOutput | undefined {
  const { objectName, columnName } = ctx
  const dialect = ctx.dialect

  if (!columnName) return undefined

  const table = ctx.schemaTable as SoftDeleteTable | undefined
  if (!table) {
    return {
      sql: [],
      docs: {
        annotations: [
          {
            object: objectName,
            text: 'Cascade triggers require Tier 2 compilation (FK detection needed)',
          },
        ],
      },
    }
  }

  // Find the FK for this column
  const fk = table.foreign_keys?.find((fk) => fk.columns?.includes(columnName))
  if (!fk?.ref_table || !fk?.ref_columns?.length) {
    return {
      sql: [],
      docs: {
        annotations: [
          {
            object: objectName,
            text: `@softdelete.cascade: column '${columnName}' has no foreign key`,
          },
        ],
      },
    }
  }

  if ((fk.columns?.length ?? 0) > 1 || fk.ref_columns.length > 1) {
    return {
      sql: [],
      docs: {
        annotations: [
          {
            object: objectName,
            text: '@softdelete.cascade does not support composite foreign keys',
          },
        ],
      },
    }
  }

  const parentTable = fk.ref_table
  const parentPkColumn = fk.ref_columns[0]

  // Get the soft-delete column name (from sibling tags or default)
  const selfTag = ctx.namespaceTags.find((t) => t.tag === null || t.tag === '$self')
  const selfArgs = (selfTag?.args ?? {}) as Record<string, unknown>
  const softDeleteColumn = (selfArgs.column as string) || (ctx.config.column as string) || 'deleted_at'

  let cascadeSqls: SqlOutput[]
  if (dialect === 'postgres') {
    cascadeSqls = generatePostgresCascade(objectName, parentTable, columnName, parentPkColumn, softDeleteColumn)
  } else if (dialect === 'mssql') {
    // MSSQL: trigger generation not yet implemented
    cascadeSqls = []
  } else if (dialect === 'mysql' || dialect === 'sqlite') {
    cascadeSqls = generatePerEventCascade(
      objectName,
      parentTable,
      columnName,
      parentPkColumn,
      softDeleteColumn,
      dialect,
    )
  } else {
    throw new Error(`ns-softdelete: unsupported dialect '${dialect}'`)
  }

  return {
    sql: cascadeSqls,
    docs: {
      relationships: [
        {
          from: parentTable,
          to: objectName,
          label: 'cascade soft-delete',
          style: 'dashed',
        },
      ],
    },
  }
}

export default plugin
