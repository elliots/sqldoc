# What is sqldoc?

sqldoc is a SQL tag compiler that transforms annotations in SQL comments into additional SQL statements and typed code output.

```sql
-- @audit.track
-- @validate.not_empty
-- @codegen(typescript)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL
);
```

Tags like `@audit.track`, `@validate.not_empty`, and `@codegen(typescript)` are compiled into:

- **SQL** — audit triggers, CHECK constraints, COMMENT ON statements, RLS policies
- **Code** — typed interfaces, query helpers, and more in 10+ languages

## Key Principles

- **SQL files are the source of truth** — tags are comments, so your `.sql` files remain valid SQL
- **Multi-dialect** — Postgres, MySQL, and SQLite are all first-class
- **Pluggable** — each tag namespace (`@audit`, `@rls`, `@validate`, etc.) is an independent plugin
- **No runtime** — sqldoc is a compiler, not a runtime dependency
