---
outline: deep
---

# Imports

SQL files use `@import` directives to declare which namespace plugins are available. Imports are per-file, like TypeScript imports.

## Syntax

```sql
-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-validate'
-- @import '@sqldoc/ns-codegen'
```

Import directives go at the top of the SQL file, before any SQL statements.

## What you can import

### Built-in namespace plugins

```sql
-- @import '@sqldoc/ns-audit'         -- Audit trail triggers
-- @import '@sqldoc/ns-anon'          -- PostgreSQL Anonymizer labels
-- @import '@sqldoc/ns-codegen'       -- Code generation hints
-- @import '@sqldoc/ns-comment'       -- COMMENT ON statements
-- @import '@sqldoc/ns-deprecated'    -- Deprecation markers
-- @import '@sqldoc/ns-docs'          -- Documentation generation
-- @import '@sqldoc/ns-lint'          -- Lint rule control
-- @import '@sqldoc/ns-postgraphile'  -- PostGraphile smart comments
-- @import '@sqldoc/ns-rls'           -- Row-Level Security policies
-- @import '@sqldoc/ns-validate'      -- CHECK constraints
```

### Custom plugins

You can import local plugin files:

```sql
-- @import './my-plugin.ts'
```

Custom plugins follow the same `NamespacePlugin` interface as built-in plugins.

## External schemas and includes

In addition to namespace imports, SQL files support two other directives:

### @external

Reference external SQL files that define objects your schema depends on but does not own:

```sql
-- @external './external/auth-tables.sql'
```

External objects are included in schema analysis but excluded from code generation and migration output. See [Compilation](/guide/compilation) for details.

### @include

Include additional SQL files whose objects should be part of your schema:

```sql
-- @include './shared/common-tables.sql'
```

Included files are treated as project files -- they participate in code generation and migrations.

## Import resolution

- Paths are resolved relative to the importing SQL file
- Glob patterns are supported: `@external './external/*.sql'`
- Circular imports are detected and produce an error
- Transitive resolution: if A imports B and B imports C, all three are processed
