---
outline: deep
---

# VSCode Extension

The sqldoc VSCode extension provides real-time tag validation, autocompletion, hover documentation, and import navigation for SQL files.

## Installation

Search for **sqldoc** in the VS Code extensions marketplace, or install from the command line:

```bash
code --install-extension elliots.vscode-sqldoc
```

## Features

### Tag Validation

The extension validates tags in real-time as you type. Errors appear as diagnostics in the editor -- wrong arguments, invalid targets, unknown namespaces, and unresolved imports are all caught immediately.

Validation runs on every save and on every text change, using the same parser as the CLI (Tier 1 -- no database needed). Diagnostics include:

- Unknown namespace errors (e.g., `@nonexistent.tag`)
- Invalid tag arguments (wrong types, missing required args)
- Invalid targets (e.g., `@audit` on a non-table statement)
- Unresolved `@import` paths
- Missing `@external`/`@include` file references

<!-- Screenshot: Tag validation showing error diagnostics in the editor -->

### Autocompletion

Type `-- @` to see available namespace completions. After a namespace, type `.` to see available tags. The extension suggests:

- **Namespace names** -- e.g., `@audit`, `@validate`, `@rls`
- **Tag names** -- e.g., `@audit.redact`, `@validate.range`, `@validate.notEmpty`
- **Named arguments** -- e.g., `on:`, `min:`, `max:`, `role:`
- **Enum values** -- e.g., `insert`, `update`, `delete` for trigger operations
- **Boolean values** -- `true`, `false` for boolean arguments

Completions are context-aware: they filter by the SQL target you're annotating. If your cursor is above a `CREATE TABLE` statement, only namespaces and tags that apply to tables are suggested.

Completions include descriptions and type information from the plugin definitions.

<!-- Screenshot: Autocompletion showing namespace and tag suggestions -->

### Hover Documentation

Hover over any tag to see its documentation. The hover popup shows different information depending on what you hover over:

**Hovering over a namespace** (`@audit`):
- Namespace name
- Self-tag description (if the namespace has a `$self` tag)
- List of all available tags with descriptions

**Hovering over a tag** (`@validate.range`):
- Full tag signature with argument types
- Tag description
- Argument details (names, types, required/optional)

**Hovering over an argument** (`min: 0`):
- Argument name and type
- Whether it's required or optional
- Allowed enum values (if applicable)
- Validation of the current value

<!-- Screenshot: Hover showing tag documentation -->

### Import Navigation

`Ctrl+Click` (or `Cmd+Click` on macOS) on an `@import`, `@external`, or `@include` path to navigate directly to the referenced file.

Works for:

| Directive | Example | Navigates to |
|-----------|---------|--------------|
| `@import` | `@import '@sqldoc/ns-audit'` | Plugin source in `.sqldoc/node_modules/` |
| `@import` | `@import './custom-plugin.ts'` | Local plugin file |
| `@external` | `@external './shared/types.sql'` | Referenced SQL file |
| `@include` | `@include './partials/common.sql'` | Referenced SQL file |

Package imports resolve through the `.sqldoc/node_modules/` directory. Relative paths resolve from the current file's directory.

### Syntax Highlighting

The extension adds TextMate grammar injection for sqldoc tags in SQL files. Tags in SQL comments are highlighted with distinct colors for each element:

| Element | Color | Example |
|---------|-------|---------|
| `@` sigil and namespace | Purple | `@audit`, `@validate` |
| Tag name | Yellow | `.range`, `.notEmpty` |
| Dot separator | Gray | `.` |
| Parentheses | Yellow | `(`, `)` |
| Argument keys | Blue | `on:`, `min:` |
| String values | Orange | `'admin'` |
| Enum values | Teal | `insert`, `update` |
| Import paths | Orange | `'@sqldoc/ns-audit'` |

The grammar also injects into TypeScript/JavaScript files for tagged template literals, providing syntax highlighting for embedded SQL, Go, Python, Java, Kotlin, Rust, and C# code.

<!-- Screenshot: Syntax highlighting showing colored tags in SQL comments -->

## Supported Languages

The extension activates for these language IDs:

- `sql`
- `pgsql`
- `plpgsql`
- `postgres`

## Configuration

The extension reads your project's `sqldoc.config.ts` to determine the dialect and available namespaces. No additional VSCode settings are needed.

The extension looks for a `.sqldoc/` directory in your workspace to resolve package imports. Make sure you've run `sqldoc init` to set up the project-local installation.

## Requirements

- VS Code 1.75 or later
- A `sqldoc.config.ts` in your workspace (or `.sqldoc/` directory)
- SQL files with sqldoc tags

## Limitations

The VSCode extension uses **Tier 1 compilation only** (SQL parsing via sqlparser-ts WASM, no database connection). This means:

- Tag validation, completion, and hover work without any database
- Import resolution and file path checking work in real-time
- Code generation previews are not available in the editor (use `sqldoc codegen` from the terminal)
- Schema-dependent features (like validating column names for audit triggers) require running the CLI

For full compilation with schema analysis, use the CLI commands (`sqldoc validate`, `sqldoc codegen`, etc.) which use Tier 2 compilation with the Atlas WASI engine.
