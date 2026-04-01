---
outline: deep
---

# Dialects

sqldoc supports three SQL dialects. The dialect is set in your config and determines how tags compile to SQL.

## Configuration

The `dialect` field is **required** in `sqldoc.config.ts`. There is no default -- sqldoc will error if you omit it.

```typescript
export default {
  dialect: 'postgres',  // 'postgres' | 'mysql' | 'sqlite'
  schema: ['./schema.sql'],
}
```

## PostgreSQL

Full support. All namespace plugins work with PostgreSQL.

```sql
-- @audit generates PL/pgSQL trigger functions
-- @rls generates ALTER TABLE ... ENABLE ROW LEVEL SECURITY + CREATE POLICY
-- @validate generates ALTER TABLE ... ADD CONSTRAINT ... CHECK
-- @comment generates COMMENT ON TABLE/COLUMN
-- @anon generates SECURITY LABEL FOR anon
```

## MySQL <Badge text="beta" />

Functional but beta. Most plugins work, with dialect-specific SQL generation.

```sql
-- @audit generates per-event triggers with JSON_OBJECT
-- @validate generates ALTER TABLE ... ADD CONSTRAINT ... CHECK
-- @comment generates ALTER TABLE ... COMMENT / ALTER TABLE ... MODIFY COLUMN ... COMMENT
```

::: warning MySQL limitations
- `@rls` is not available (MySQL does not support row-level security)
- `@anon` is not available (PostgreSQL Anonymizer is Postgres-specific)
- `@postgraphile` is not available (PostGraphile is Postgres-specific)
- `@audit` requires Tier 2 compilation (column enumeration needed for JSON serialization)
:::

## SQLite <Badge text="beta" />

Functional but beta. Core plugins work with SQLite-specific syntax.

```sql
-- @audit generates per-event triggers with json_object
-- @validate generates CHECK constraints
```

::: warning SQLite limitations
- `@rls`, `@anon`, `@postgraphile` are not available
- `@comment` is not supported (SQLite has no COMMENT syntax)
- `@audit` requires Tier 2 compilation
:::

## Dialect differences

| Feature | PostgreSQL | MySQL | SQLite |
|---------|-----------|-------|--------|
| Identifier quoting | `"name"` | `` `name` `` | `"name"` |
| JSON type | `JSONB` | `JSON` | `TEXT` |
| Timestamp type | `TIMESTAMPTZ` | `TIMESTAMP` | `TEXT` |
| Current timestamp | `now()` | `CURRENT_TIMESTAMP` | `datetime('now')` |
| Auto-increment | `SERIAL` / `BIGSERIAL` | `AUTO_INCREMENT` | `AUTOINCREMENT` |
| Audit triggers | Multi-event, PL/pgSQL | Per-event, inline | Per-event, inline |
