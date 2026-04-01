---
outline: deep
---

# Tags

Tags are SQL comments that sqldoc compiles into SQL statements or code. They follow a consistent syntax across all namespace plugins.

## Syntax

```
-- @namespace.tag(args)
```

Tags are always on the line(s) immediately above the SQL statement they apply to.

### Table-level tags

Tags above a `CREATE TABLE` statement apply to the table:

```sql
-- @audit
-- @rls
CREATE TABLE orders (...);
```

### Column-level tags

Tags above a column definition apply to that column:

```sql
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  -- @validate.notEmpty
  -- @comment('Customer display name')
  name VARCHAR(100) NOT NULL
);
```

### Standalone namespace tags

Some namespaces support a standalone form without a dot:

```sql
-- @audit          -- same as @audit.$self
-- @rls            -- same as @rls.$self
```

## Arguments

Tags can accept arguments in two forms:

### Named arguments

```sql
-- @audit(on: [insert, update], destination: 'orders_log')
-- @rls.policy(for: SELECT, to: authenticated, using: 'user_id = current_user()')
-- @validate.range(min: 0, max: 99999)
```

### Positional arguments

```sql
-- @comment('This is a comment')
-- @anon.mask('anon.partial(email, 2, $$***$$, 2)')
```

### Array arguments

```sql
-- @audit(on: [insert, update, delete])
```

### No arguments

```sql
-- @audit
-- @validate.notEmpty
-- @rls
```

## Targets

Each tag specifies which SQL objects it can target:

| Target | Example |
|--------|---------|
| `table` | `CREATE TABLE ...` |
| `column` | Column definition inside CREATE TABLE |
| `view` | `CREATE VIEW ...` |
| `function` | `CREATE FUNCTION ...` |
| `index` | `CREATE INDEX ...` |
| `enum` | `CREATE TYPE ... AS ENUM` |

A tag used on the wrong target produces a validation error:

```
Error: @validate.notEmpty targets [column] but found on table 'orders'
```

## Multiple tags

You can stack multiple tags on a single object:

```sql
-- @comment('Customer orders')
-- @audit(on: [insert, update, delete])
-- @rls
-- @rls.policy(for: SELECT, to: PUBLIC, using: 'true')
-- @docs.description('Central order tracking table')
CREATE TABLE orders (...);
```

Tags from different namespaces do not interfere with each other.

## See Also

- [Namespaces](/namespaces/) -- all available tag plugins
- [Imports](/guide/imports) -- how to import namespace plugins
- [Compilation](/guide/compilation) -- how tags become SQL
