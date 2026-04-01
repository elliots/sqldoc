---
outline: deep
---

# CLI Reference

The sqldoc CLI provides commands for code generation, validation, linting, schema management, and migrations.

## Installation

::: code-group

```bash [Homebrew]
brew install elliots/sqldoc/sqldoc
```

```bash [npm (project-local)]
npx @sqldoc/cli init
```

```bash [Binary]
# Download from GitHub Releases
# https://github.com/elliots/sqldoc/releases
```

:::

## Global Options

Every command accepts these options:

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to `sqldoc.config.ts` |
| `--project <name>` | Select a named project from multi-project config |
| `-V, --version` | Output the version number |
| `-h, --help` | Display help for the command |

## Commands

### `sqldoc codegen`

Run code generation plugins (templates, docs, etc.).

```bash
sqldoc codegen [path] [options]
```

| Option | Description |
|--------|-------------|
| `[path]` | Path to SQL files or directory (defaults to config `schema`) |
| `-c, --config <path>` | Path to `sqldoc.config.ts` |
| `-p, --plugins <names>` | Comma-separated project-level plugin names to run (default: all) |
| `--project <name>` | Select a named project from multi-project config |

**Examples:**

```bash
# Generate all configured outputs
sqldoc codegen

# Generate from specific SQL files
sqldoc codegen ./schema/*.sql

# Generate only docs output
sqldoc codegen -p docs

# Generate for a specific project in multi-project config
sqldoc codegen --project main
```

### `sqldoc validate`

Validate tags in SQL files. Checks for unknown namespaces, invalid tag arguments, wrong targets, and import resolution errors.

```bash
sqldoc validate [path] [options]
```

| Option | Description |
|--------|-------------|
| `[path]` | Path to SQL files or directory (defaults to config `schema`) |
| `-c, --config <path>` | Path to `sqldoc.config.ts` |
| `--project <name>` | Select a named project from multi-project config |

**Examples:**

```bash
# Validate all schema files
sqldoc validate

# Validate a specific file
sqldoc validate ./schema/users.sql

# Validate with a specific config
sqldoc validate -c ./custom-config.ts
```

### `sqldoc lint`

Run lint rules from namespace plugins against SQL files. Plugins can define custom lint rules that check for best practices, missing tags, or common mistakes.

```bash
sqldoc lint [path] [options]
```

| Option | Description |
|--------|-------------|
| `[path]` | Path to SQL files or directory (defaults to config `schema`) |
| `-c, --config <path>` | Path to `sqldoc.config.ts` |
| `-v, --verbose` | Show ignored rules |
| `--project <name>` | Select a named project from multi-project config |

**Examples:**

```bash
# Lint all schema files
sqldoc lint

# Lint with verbose output (shows ignored rules)
sqldoc lint -v

# Lint a specific directory
sqldoc lint ./schema/
```

### `sqldoc schema inspect`

Inspect schema from SQL files, directory, or database. Uses the Atlas WASI engine to parse and normalize schema.

```bash
sqldoc schema inspect [source] [options]
```

| Option | Description |
|--------|-------------|
| `[source]` | SQL file, directory, or database URL (defaults to config `schema`) |
| `-c, --config <path>` | Path to `sqldoc.config.ts` |
| `-f, --format <format>` | Output format: `sql`, `json` (default: `sql`) |
| `--dev-url <url>` | Dev database URL (`pglite`, `docker://<image>`, `dockerfile://<path>`, `postgres://...`) |
| `--project <name>` | Select a named project from multi-project config |

**Examples:**

```bash
# Inspect compiled schema as normalized SQL
sqldoc schema inspect

# Inspect as JSON
sqldoc schema inspect -f json

# Inspect a live database
sqldoc schema inspect postgres://localhost:5432/mydb

# Inspect using Docker for dev database
sqldoc schema inspect --dev-url docker://postgres:16
```

### `sqldoc schema diff`

Compare two schema states. Useful for reviewing changes before generating migrations, or as a CI check to detect schema drift.

```bash
sqldoc schema diff [options]
```

| Option | Description |
|--------|-------------|
| `--from <source>` | Source state: SQL file, directory, or database URL (default: empty) |
| `--to <source>` | Target state: SQL file, directory, or database URL |
| `-c, --config <path>` | Path to `sqldoc.config.ts` |
| `-f, --format <format>` | Output format: `sql`, `json`, `pretty` (default: `sql`) |
| `--dev-url <url>` | Dev database URL (`pglite`, `docker://<image>`, `dockerfile://<path>`, `postgres://...`) |
| `--check` | Exit non-zero if schemas differ (CI mode) |
| `--project <name>` | Select a named project from multi-project config |

**Examples:**

```bash
# Diff from empty to current schema (see all statements)
sqldoc schema diff --to ./schema/

# Diff between two schema versions
sqldoc schema diff --from ./v1.sql --to ./v2.sql

# Pretty-print the diff
sqldoc schema diff --from ./v1.sql --to ./v2.sql -f pretty

# CI check: fail if production schema differs from source
sqldoc schema diff --from postgres://prod/db --to ./schema/ --check
```

### `sqldoc migrate`

Generate migration files or check for schema drift. Compares the current schema (SQL files + compiled tag output) against existing migrations and generates a new migration if they differ.

```bash
sqldoc migrate [options]
```

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to `sqldoc.config.ts` |
| `--project <name>` | Select a named project from multi-project config |
| `--check` | Exit non-zero if schema differs from migrations (CI mode) |
| `--name <name>` | Custom migration name |
| `--force` | Allow destructive changes (DROP TABLE, DROP COLUMN, etc.) |

**Examples:**

```bash
# Generate a migration
sqldoc migrate

# Generate with a custom name
sqldoc migrate --name add-orders-table

# CI check: verify no schema drift
sqldoc migrate --check

# Allow destructive changes
sqldoc migrate --force --name remove-legacy-tables
```

### `sqldoc doctor`

Check project setup and report status. Verifies configuration, plugin availability, database connectivity, and reports any issues.

```bash
sqldoc doctor
```

**Example output:**

```
sqldoc doctor
  Config:     sqldoc.config.ts found
  Dialect:    postgres
  Plugins:    @sqldoc/ns-audit, @sqldoc/ns-validate, @sqldoc/ns-codegen
  Schema:     ./schema/ (12 files)
  Dev DB:     pglite (in-memory)
  Status:     All checks passed
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid config, validation failure, database connection error) |
| `2` | Schema drift detected (when using `--check`) |

## Configuration

The CLI reads configuration from `sqldoc.config.ts` in your project root. See the [Configuration guide](/guide/configuration) for details.

```typescript
import { defineConfig } from '@sqldoc/cli'

export default defineConfig({
  dialect: 'postgres',
  schema: './schema/',
  plugins: {
    audit: {},
    validate: {},
    codegen: {
      templates: ['typescript', 'zod'],
      output: './src/generated/',
    },
  },
})
```
