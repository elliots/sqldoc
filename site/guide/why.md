---
outline: deep
---

# Why sqldoc?

## SQL is the source of truth

Most projects define their schema in an ORM, a migration tool, or a code-first framework. The actual SQL is a derived artifact -- generated, hidden, or scattered across migration files.

sqldoc takes the opposite approach: **your SQL files are the source of truth**. Everything else -- typed interfaces, audit triggers, RLS policies, documentation -- is compiled from SQL.

```sql
-- This is your schema. It's valid SQL.
-- Tags in comments add behavior without changing the SQL.
-- @audit
-- @rls
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  total NUMERIC(10,2) NOT NULL
);
```

Why this matters:
- Your DBA can read the schema files directly
- `psql -f schema.sql` still works
- Any SQL tool (pgAdmin, DataGrip, VS Code) understands the files
- Version control diffs show exactly what changed

## The problem: drift

SQL is already the best language for defining database schemas. But a `CREATE TABLE` statement alone doesn't capture everything a table needs: audit trails, row-level security policies, validation constraints, generated types for your application, documentation for your team.

Today, this surrounding infrastructure is scattered across migration files, application code, wiki pages, and tribal knowledge. It drifts. The audit trigger gets updated but the TypeScript types don't. The docs show columns that were dropped two sprints ago. The validation rules in the application don't match the CHECK constraints in the database.

sqldoc eliminates the drift by making everything derivable from the SQL file. Tags in comments declare intent -- "this table is audited", "this column must not be empty", "generate TypeScript types" -- and the compiler produces the correct SQL and code for your target database.

You keep writing SQL. sqldoc handles the rest.

## Who it's for

**Teams that write and maintain SQL schemas directly.** If your schema lives in `.sql` files -- whether you're a backend team with migration files, a data team managing DDL, or a full-stack team that prefers SQL over ORMs -- sqldoc is for you.

You probably:
- Have opinions about your database schema and don't want an ORM generating it
- Maintain boilerplate SQL alongside your schema (triggers, policies, constraints) and wish it was automated
- Want typed code generated from your schema but don't want to adopt a framework to get it
- Support multiple applications or languages consuming the same database

sqldoc doesn't replace your database, your migration tool, or your query layer. It sits upstream of all of them, generating correct SQL and typed code from your annotated schema.

## Compile-time, not runtime

sqldoc is a build tool. It runs during development and CI, not in production. Your application never imports or depends on sqldoc.

```bash
# During development
sqldoc codegen          # Generate typed code
sqldoc validate         # Check tag correctness
sqldoc migrate          # Generate migration files

# In production: nothing. sqldoc doesn't exist here.
```

This means:
- Zero runtime overhead
- No ORM query builder performance surprises
- No dependency on sqldoc being available at deploy time
- Generated code can be committed or gitignored -- your choice

## Tags live in comments

Every sqldoc tag is a SQL comment. This is deliberate:

```sql
-- @validate.notEmpty        -- This is a valid SQL comment
-- @audit(on: [insert])      -- So is this
CREATE TABLE users (         -- Standard SQL from here down
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL
);
```

Because tags are comments:
- The SQL is always valid and executable
- Tools that don't know about sqldoc ignore the tags
- Syntax highlighting works (with the VS Code extension, tags are highlighted too)
- You can gradually adopt sqldoc -- add one tag at a time

## The real idea: your own namespaces

The built-in plugins (`@audit`, `@rls`, `@validate`, etc.) demonstrate the pattern. But they're not the point. The intended use is that **you write your own**, encoding your team's standards, your company's conventions, and your project's requirements into tags that generate exactly the SQL you need.

A namespace plugin is a single TypeScript file:

```typescript
// team-standards.ts
import type { NamespacePlugin } from '@sqldoc/core'

export default {
  apiVersion: 1,
  name: 'team',
  tags: {
    $self: {
      description: 'Apply team standard columns and triggers',
      targets: ['table'],
    },
    softDelete: {
      description: 'Add soft-delete column and index',
      targets: ['table'],
    },
  },

  onTag(ctx) {
    if (ctx.tag.name === '$self' || ctx.tag.name === null) {
      return [
        { sql: `ALTER TABLE "${ctx.objectName}" ADD COLUMN "updated_at" TIMESTAMPTZ DEFAULT now();` },
        { sql: `ALTER TABLE "${ctx.objectName}" ADD COLUMN "updated_by" TEXT;` },
      ]
    }
    if (ctx.tag.name === 'softDelete') {
      return [
        { sql: `ALTER TABLE "${ctx.objectName}" ADD COLUMN "deleted_at" TIMESTAMPTZ;` },
        { sql: `CREATE INDEX "${ctx.objectName}_active" ON "${ctx.objectName}" (id) WHERE deleted_at IS NULL;` },
      ]
    }
  },
} satisfies NamespacePlugin
```

Import it directly from your SQL:

```sql
-- @import './team-standards.ts'

-- @team
-- @team.softDelete
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
```

No npm package, no build step, no registration. One file, one import, and your team's conventions are enforced and generated automatically.

### What you can do with custom namespaces

The tag context gives your plugin everything it needs to generate intelligent SQL:

- **`ctx.dialect`** -- generate different SQL for Postgres, MySQL, and SQLite
- **`ctx.target`** and **`ctx.objectName`** -- know what SQL object the tag is attached to
- **`ctx.columnName`** and **`ctx.columnType`** -- for column-level tags, know the column details
- **`ctx.tag.args`** -- access positional or named arguments from the tag
- **`ctx.siblingTags`** -- see what other namespaces are on the same object
- **`ctx.config`** -- read namespace-specific config from `sqldoc.config.ts`

Some things teams have built:

- **`@tenant`** -- multi-tenant isolation: add `tenant_id` column, foreign key, and partial unique indexes
- **`@history`** -- temporal tables: create a history table mirroring the source with valid_from/valid_to columns
- **`@notify`** -- Postgres LISTEN/NOTIFY triggers for real-time change events
- **`@partition`** -- generate range/list partitioning DDL from declarative tags
- **`@mask`** -- dynamic data masking views for non-production environments
- **`@metric`** -- generate Prometheus-compatible COMMENT ON metadata for monitoring tools

Each of these is a single `.ts` file that a developer on the team wrote in an afternoon.

## Multi-dialect by design

sqldoc supports PostgreSQL, MySQL, and SQLite as first-class dialects. The `dialect` field is required in every config -- there's no default.

```typescript
// sqldoc.config.ts
export default {
  dialect: 'postgres',  // Required. Never defaults.
  schema: ['./schema.sql'],
}
```

Each namespace plugin generates dialect-correct SQL:

| Tag | PostgreSQL | MySQL | SQLite |
|-----|-----------|-------|--------|
| `@audit` | PL/pgSQL trigger function | Per-event triggers with JSON_OBJECT | Per-event triggers with json_object |
| `@validate.notEmpty` | `CHECK (length(trim(col)) > 0)` | `CHECK (CHAR_LENGTH(TRIM(col)) > 0)` | `CHECK (length(trim(col)) > 0)` |
| `@comment` | `COMMENT ON TABLE` | `ALTER TABLE ... COMMENT` | *(not supported)* |

::: info Beta dialects
MySQL and SQLite support is functional but marked as beta. PostgreSQL has the most complete coverage.
:::

## Namespace plugins

Each concern is a separate namespace:

| Namespace | What it does |
|-----------|-------------|
| `@audit` | Audit trail triggers |
| `@rls` | Row-Level Security policies |
| `@validate` | CHECK constraints |
| `@codegen` | Code generation hints (rename, skip, type) |
| `@comment` | COMMENT ON statements |
| `@docs` | HTML documentation + Mermaid ER diagrams |
| `@deprecated` | Deprecation markers |
| `@anon` | PostgreSQL Anonymizer labels |
| `@postgraphile` | PostGraphile smart comments |
| `@lint` | Lint rule control |

You import only what you need:

```sql
-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-validate'

-- Only @audit and @validate tags are available in this file
```

## Code generation

sqldoc generates typed code in 10+ languages from your SQL schema:

```bash
sqldoc codegen
```

Templates include TypeScript interfaces, Go structs, Python dataclasses, Rust structs, Zod schemas, Drizzle models, Prisma schemas, and more. See the full list in [Templates](/templates/).

The generated code matches your SQL schema exactly -- column types, nullability, constraints, and relationships are all reflected in the output.

## What sqldoc is not

- **Not an ORM.** It doesn't execute queries or manage connections. Use whatever query layer you prefer.
- **Not a migration runner.** It generates migration SQL. Use Atlas, Flyway, goose, dbmate, or plain `psql` to apply them.
- **Not a schema language.** Your files are standard SQL. The tags are in comments. Remove sqldoc and your SQL still works.
- **Not a framework.** There's no runtime dependency. The output is static SQL and code files.

## Getting started

Ready to try it?

- [Installation](/guide/installation) -- get sqldoc running
- [Quick Start](/guide/quick-start) -- build something in 5 minutes
- [Namespaces](/namespaces/) -- explore all tag plugins
- [Templates](/templates/) -- see available code generation targets
