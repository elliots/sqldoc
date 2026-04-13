# Namespace Plugins

- Paths covered: active `packages/ns-*` packages
- Last reviewed commit: `9571d50fee5356b058cec0247aa5189272b53de6`
- Related docs: [core-compiler.md](./core-compiler.md), [project-output.md](./project-output.md), [testing-and-fixtures.md](./testing-and-fixtures.md)

Namespace packages define tag semantics. Most are file-level or object-level compile-time plugins that emit SQL, docs metadata, or lint diagnostics through the `NamespacePlugin` contract in `@sqldoc/core`.

Two namespaces are special enough to merit their own deeper doc:

- `ns-codegen`
- `ns-docs`

See [project-output.md](./project-output.md) for their after-compile behavior.

## Active Namespace Packages

| Package | Key tags | Main effect | Start here | Test evidence |
| --- | --- | --- | --- | --- |
| `ns-anon` | `@anon.mask`, `@anon.fake`, `@anon` | PostgreSQL Anonymizer `SECURITY LABEL` statements | [`packages/ns-anon/src/index.ts`](../packages/ns-anon/src/index.ts) | [`packages/ns-anon/src/__tests__/anon.test.ts`](../packages/ns-anon/src/__tests__/anon.test.ts) |
| `ns-audit` | `@audit`, `@audit.redact` | Audit log table/triggers plus docs relationships and lint rule | [`packages/ns-audit/src/index.ts`](../packages/ns-audit/src/index.ts) | [`packages/ns-audit/src/__tests__/audit.test.ts`](../packages/ns-audit/src/__tests__/audit.test.ts), [`audit.integration.test.ts`](../packages/ns-audit/src/__tests__/audit.integration.test.ts) |
| `ns-comment` | `@comment` | Emits SQL comments appropriate to the dialect | [`packages/ns-comment/src/index.ts`](../packages/ns-comment/src/index.ts) | [`packages/ns-comment/src/__tests__/comment.test.ts`](../packages/ns-comment/src/__tests__/comment.test.ts) |
| `ns-deprecated` | `@deprecated`, `@deprecated.replace`, `@deprecated.removeAfter` | Marks objects deprecated via comments | [`packages/ns-deprecated/src/index.ts`](../packages/ns-deprecated/src/index.ts) | [`packages/ns-deprecated/src/__tests__/deprecated.test.ts`](../packages/ns-deprecated/src/__tests__/deprecated.test.ts) |
| `ns-history` | `@history` | Creates `{table}_history` tables and history triggers | [`packages/ns-history/src/index.ts`](../packages/ns-history/src/index.ts) | [`packages/ns-history/src/__tests__/history.test.ts`](../packages/ns-history/src/__tests__/history.test.ts), [`history.integration.test.ts`](../packages/ns-history/src/__tests__/history.integration.test.ts) |
| `ns-lint` | `@lint.ignore` | Suppresses lint rules with a mandatory reason | [`packages/ns-lint/src/index.ts`](../packages/ns-lint/src/index.ts) | [`packages/ns-lint/src/__tests__/lint.test.ts`](../packages/ns-lint/src/__tests__/lint.test.ts) |
| `ns-postgraphile` | `@postgraphile.omit`, `rename`, `deprecated`, `simpleCollections`, `behavior` | Emits PostGraphile smart comments | [`packages/ns-postgraphile/src/index.ts`](../packages/ns-postgraphile/src/index.ts) | [`packages/ns-postgraphile/src/__tests__/postgraphile.test.ts`](../packages/ns-postgraphile/src/__tests__/postgraphile.test.ts) |
| `ns-rls` | `@rls`, `@rls.policy` | Enables row-level security and creates policies | [`packages/ns-rls/src/index.ts`](../packages/ns-rls/src/index.ts) | [`packages/ns-rls/src/__tests__/rls.test.ts`](../packages/ns-rls/src/__tests__/rls.test.ts), [`rls.integration.test.ts`](../packages/ns-rls/src/__tests__/rls.integration.test.ts) |
| `ns-softdelete` | `@softdelete`, `@softdelete.cascade` | Adds soft-delete columns, active views, and cascade triggers | [`packages/ns-softdelete/src/index.ts`](../packages/ns-softdelete/src/index.ts) | [`packages/ns-softdelete/src/__tests__/softdelete.test.ts`](../packages/ns-softdelete/src/__tests__/softdelete.test.ts), [`softdelete.integration.test.ts`](../packages/ns-softdelete/src/__tests__/softdelete.integration.test.ts) |
| `ns-temporal` | `@temporal` | Adds SCD-style validity columns, current view, temporal triggers | [`packages/ns-temporal/src/index.ts`](../packages/ns-temporal/src/index.ts) | [`packages/ns-temporal/src/__tests__/temporal.test.ts`](../packages/ns-temporal/src/__tests__/temporal.test.ts), [`temporal.integration.test.ts`](../packages/ns-temporal/src/__tests__/temporal.integration.test.ts) |
| `ns-validate` | `@validate.check`, `notEmpty`, `range`, `length`, `pattern` | Adds check constraints and docs metadata; also contributes lint rules | [`packages/ns-validate/src/index.ts`](../packages/ns-validate/src/index.ts) | [`packages/ns-validate/src/__tests__/validate.test.ts`](../packages/ns-validate/src/__tests__/validate.test.ts), [`validate.integration.test.ts`](../packages/ns-validate/src/__tests__/validate.integration.test.ts) |
| `ns-codegen` | `@codegen.rename`, `skip`, `type` | Project-level template execution after compile | [`packages/ns-codegen/src/index.ts`](../packages/ns-codegen/src/index.ts) | See [project-output.md](./project-output.md) |
| `ns-docs` | `@docs.emit`, `description`, `previously` | Project-level docs rendering after compile | [`packages/ns-docs/src/index.ts`](../packages/ns-docs/src/index.ts) | See [project-output.md](./project-output.md) |

## Cross-Cutting Patterns

Common things most namespace packages do:

- Export `const plugin: NamespacePlugin` as the default export.
- Define a `tags` object that drives validation and editor completions.
- Implement `onTag()` for per-tag SQL/docs output or `afterCompile()` for project-level output.
- Optionally ship `lintRules` consumed later by `core.lint()`.
- Rely on dialect helpers from `@sqldoc/core/sql-emitter.ts`.

Packages that depend heavily on Tier 2 / Atlas realm data:

- `ns-audit` on MySQL/SQLite, because trigger bodies need explicit column enumeration
- `ns-history`, because history tables mirror the inspected columns
- `ns-softdelete.cascade`, because FK relationships matter
- `ns-temporal`, because PK and column lists drive temporal behavior
- `ns-codegen` and `ns-docs`, because they are explicitly project-level post-inspection plugins

## Best Fixture Reads

If you need to understand how multiple namespaces interact together, read:

- [`tests/pet-store-postgres/schema.sql`](../tests/pet-store-postgres/schema.sql)
- [`tests/pet-store-postgres/pet-store.test.ts`](../tests/pet-store-postgres/pet-store.test.ts)
- [`tests/__tests__/pipeline.test.ts`](../tests/__tests__/pipeline.test.ts)

Those fixtures cover imports, externals, includes, docs/codegen, and multiple namespace combinations in one realistic project.

## Update Breadcrumbs

- Revisit this doc when a new namespace package is published.
- Re-check key tags when a plugin’s `tags` object changes; that is the authoritative editor/validator contract.
- Keep the “project-level” distinction for `ns-codegen` and `ns-docs` in sync with their actual use of `afterCompile()`.
