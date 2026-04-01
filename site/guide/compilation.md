---
outline: deep
---

# Compilation

sqldoc compiles tags in two tiers. Understanding the tiers helps explain which features need a dev database and which work standalone.

## Tier 1: Parse and validate

Tier 1 uses the SQL parser (sqlparser-ts, compiled from Rust to WASM) to:

1. **Parse** the SQL file into an AST
2. **Identify** which SQL object each tag block targets
3. **Validate** tags against their namespace definitions (correct args, correct targets)
4. **Invoke** plugin `onTag()` handlers to generate SQL output

Tier 1 works entirely in memory -- no database needed. It powers:
- `sqldoc validate`
- VS Code extension (real-time validation)
- Basic `sqldoc codegen` (tag compilation)

## Tier 2: Schema analysis

Tier 2 uses Atlas (compiled from Go to WASI) plus a dev database to:

1. **Load** the compiled SQL into a database
2. **Inspect** the resulting schema (tables, columns, types, constraints, relationships)
3. **Diff** schemas for migration generation

Tier 2 enables:
- Code generation templates (they read the full schema, not just tags)
- `sqldoc schema inspect` and `sqldoc schema diff`
- `sqldoc migrate` (generates migration files)
- Plugins that need column info (e.g., `@audit` on MySQL/SQLite needs column names for JSON serialization)

## Pipeline flow

```
SQL files with tags
       |
       v
  [Parse SQL]          -- sqlparser-ts WASM
       |
       v
  [Parse tags]         -- regex extraction from comments
       |
       v
  [Resolve imports]    -- @import, @external, @include
       |
       v
  [Validate tags]      -- check args, targets, namespace rules
       |
       v
  [Compile tags]       -- invoke plugin onTag() handlers
       |
       v
  [Merge SQL]          -- original SQL + generated SQL
       |
       v
  [Atlas inspect]      -- load into dev database, inspect schema (Tier 2)
       |
       v
  [Generate code]      -- run templates against inspected schema (Tier 2)
```

## External and include files

The compilation pipeline handles three types of SQL files:

| Type | Source | In codegen? | In migrations? |
|------|--------|-------------|----------------|
| Project | Your `schema` files | Yes | Yes |
| External | `@external` directive | No (filtered out) | No (cancelled on both sides of diff) |
| Include | `@include` directive | Yes | Yes |

External files let you reference objects your schema depends on (like auth tables from another service) without generating code or migrations for them.
