# What is sqldoc?

sqldoc is a SQL tag compiler that transforms annotations in SQL comments into additional SQL statements and typed code output.

## How it works

Write standard SQL with tags in comments:

```sql
-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-validate'

-- @audit
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  -- @validate.notEmpty
  customer_name VARCHAR(100) NOT NULL,
  -- @validate.range(min: 0)
  total NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
```

Run `sqldoc codegen` and the compiler produces:

- **SQL statements** -- audit triggers, CHECK constraints, COMMENT ON statements, RLS policies, and more
- **Typed code** -- interfaces, models, and query helpers in 10+ languages

Your SQL files stay valid SQL. Tags live in comments, so any SQL tool can still read them.

## Key Principles

- **SQL files are the source of truth** -- tags are comments, so your `.sql` files remain valid SQL
- **Compile-time, not runtime** -- sqldoc is a build tool, not a dependency in your application
- **Multi-dialect** -- PostgreSQL, MySQL, and SQLite are all first-class citizens
- **Pluggable** -- each tag namespace (`@audit`, `@rls`, `@validate`, etc.) is an independent plugin
- **No lock-in** -- the output is standard SQL and standard typed code

::: tip Want the full story?
Read [Why sqldoc?](/guide/why) for the philosophy behind the project.
:::

## Next Steps

- [Installation](/guide/installation) -- get sqldoc running
- [Quick Start](/guide/quick-start) -- build something in 5 minutes
- [Namespaces](/namespaces/) -- explore all tag plugins
- [Templates](/templates/) -- see available code generation targets
