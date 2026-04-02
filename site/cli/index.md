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

or download the latest release from [GitHub Releases](https://github.com/elliots/sqldoc/releases) for your platform.

```bash 
sqldoc init
```

:::

## `sqldoc compile`

Compile SQL files and output merged SQL with generated statements

```bash
sqldoc compile [path] [options]
```

**Arguments:**

| Name | Required | Description |
|------|----------|-------------|
| `path` | No | Path to SQL files or directory (defaults to config schema) |

**Options:**

| Flag | Description |
|------|-------------|
| <code v-pre>-c, --config &lt;path&gt;</code> | Path to sqldoc.config.ts |
| <code v-pre>-o, --output &lt;path&gt;</code> | Write to file instead of stdout |
| <code v-pre>--project &lt;name&gt;</code> | Select a named project from multi-project config |

---

## `sqldoc codegen`

Run code generation plugins (templates, docs, etc.)

```bash
sqldoc codegen [path] [options]
```

**Arguments:**

| Name | Required | Description |
|------|----------|-------------|
| `path` | No | Path to SQL files or directory (defaults to config schema) |

**Options:**

| Flag | Description |
|------|-------------|
| <code v-pre>-c, --config &lt;path&gt;</code> | Path to sqldoc.config.ts |
| <code v-pre>-p, --plugins &lt;names&gt;</code> | Comma-separated project-level plugin names to run (default: all) |
| <code v-pre>-t, --template &lt;names&gt;</code> | Run template(s) by slug (comma-separated), ignoring config (output to stdout or -o dir) |
| <code v-pre>-o, --output &lt;path&gt;</code> | Output file path (used with --template) |
| <code v-pre>--project &lt;name&gt;</code> | Select a named project from multi-project config |

---

## `sqldoc validate`

Validate tags in SQL files

```bash
sqldoc validate [path] [options]
```

**Arguments:**

| Name | Required | Description |
|------|----------|-------------|
| `path` | No | Path to SQL files or directory (defaults to config schema) |

**Options:**

| Flag | Description |
|------|-------------|
| <code v-pre>-c, --config &lt;path&gt;</code> | Path to sqldoc.config.ts |
| <code v-pre>--project &lt;name&gt;</code> | Select a named project from multi-project config |

---

## `sqldoc lint`

Run lint rules from namespace plugins against SQL files

```bash
sqldoc lint [path] [options]
```

**Arguments:**

| Name | Required | Description |
|------|----------|-------------|
| `path` | No | Path to SQL files or directory (defaults to config schema) |

**Options:**

| Flag | Description |
|------|-------------|
| <code v-pre>-c, --config &lt;path&gt;</code> | Path to sqldoc.config.ts |
| <code v-pre>-v, --verbose</code> | Show ignored rules |
| <code v-pre>--project &lt;name&gt;</code> | Select a named project from multi-project config |

---

## `sqldoc schema`

Schema inspection and comparison

```bash
sqldoc schema [options]
```

### `sqldoc schema inspect`

Inspect schema from SQL files, directory, or database

```bash
sqldoc schema inspect [source] [options]
```

**Arguments:**

| Name | Required | Description |
|------|----------|-------------|
| `source` | No | SQL file, directory, or database URL (defaults to config schema) |

**Options:**

| Flag | Description |
|------|-------------|
| <code v-pre>-c, --config &lt;path&gt;</code> | Path to sqldoc.config.ts |
| <code v-pre>-f, --format &lt;format&gt;</code> | Output format: sql, json |
| <code v-pre>--dev-url &lt;url&gt;</code> | Dev database URL (pglite, docker://&lt;image&gt;, dockerfile://&lt;path&gt;, postgres://...) |
| <code v-pre>--project &lt;name&gt;</code> | Select a named project from multi-project config |

### `sqldoc schema diff`

Compare two schema states

```bash
sqldoc schema diff [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| <code v-pre>--from &lt;source&gt;</code> | Source state: SQL file, directory, or database URL (default: empty) |
| <code v-pre>--to &lt;source&gt;</code> | Target state: SQL file, directory, or database URL |
| <code v-pre>-c, --config &lt;path&gt;</code> | Path to sqldoc.config.ts |
| <code v-pre>-f, --format &lt;format&gt;</code> | Output format: sql, json, pretty |
| <code v-pre>--dev-url &lt;url&gt;</code> | Dev database URL (pglite, docker://&lt;image&gt;, dockerfile://&lt;path&gt;, postgres://...) |
| <code v-pre>--check</code> | Exit non-zero if schemas differ (CI mode) |
| <code v-pre>--project &lt;name&gt;</code> | Select a named project from multi-project config |

---

## `sqldoc migrate`

Generate migration files or check for schema drift

```bash
sqldoc migrate [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| <code v-pre>-c, --config &lt;path&gt;</code> | Path to sqldoc.config.ts |
| <code v-pre>--project &lt;name&gt;</code> | Select a named project from multi-project config |
| <code v-pre>--check</code> | Exit non-zero if schema differs from migrations (CI mode) |
| <code v-pre>--name &lt;name&gt;</code> | Custom migration name |
| <code v-pre>--force</code> | Allow destructive changes (DROP TABLE, DROP COLUMN, etc.) |

---

## `sqldoc doctor`

Check project setup and report status

```bash
sqldoc doctor [options]
```

