# Testing And Fixtures

- Paths covered: `packages/test-utils`, `tests`, package-level `src/__tests__`
- Last reviewed commit: `9571d50fee5356b058cec0247aa5189272b53de6`
- Related docs: [core-compiler.md](./core-compiler.md), [schema-engine.md](./schema-engine.md), [namespaces.md](./namespaces.md)

The repo uses tests as executable documentation. If an agent needs to confirm intended behavior, tests are usually the fastest trustworthy source after reading the implementation.

## Test Layers

| Layer | Where | What it proves |
| --- | --- | --- |
| Unit tests inside packages | `packages/*/src/__tests__` | Individual parser, compiler, plugin, template, CLI-helper, and inspector behaviors. |
| Pipeline/workflow tests | [`tests/__tests__/pipeline.test.ts`](../tests/__tests__/pipeline.test.ts), [`tests/__tests__/workflows/cli-workflows.test.ts`](../tests/__tests__/workflows/cli-workflows.test.ts) | End-to-end compile/validate/codegen behavior using temporary projects. |
| Fixture projects | `tests/pet-store-*`, `tests/postgraphile-kitchensink`, `tests/pagila`, `tests/sakila-mssql` | Realistic multi-file schemas, migrations, generated outputs, external/include behavior, and dialect differences. |
| Snapshot tests | `tests/_helpers/snapshots`, `packages/inspector/src/__tests__/snapshot-comparison.test.ts` | Regression checks for inspected schema shape and inspector parity. |

## `packages/test-utils`

Read these when a test helper obscures what the CLI is doing:

- [`packages/test-utils/src/index.ts`](../packages/test-utils/src/index.ts)
- [`packages/test-utils/src/cli.ts`](../packages/test-utils/src/cli.ts)
- [`packages/test-utils/src/test.ts`](../packages/test-utils/src/test.ts)
- [`packages/test-utils/src/tmp-dir.ts`](../packages/test-utils/src/tmp-dir.ts)

`initProject()` is especially important because many tests depend on `.sqldoc` dev-mode symlinks into the monorepo.

## Best Fixture Projects

| Fixture | Key files | Why it matters |
| --- | --- | --- |
| `tests/pet-store-postgres` | [`schema.sql`](../tests/pet-store-postgres/schema.sql), [`sqldoc.config.ts`](../tests/pet-store-postgres/sqldoc.config.ts), [`pet-store.test.ts`](../tests/pet-store-postgres/pet-store.test.ts) | Broadest realistic fixture. Covers many namespaces, codegen, docs, externals, includes, custom local plugin, and migrations. |
| `tests/pet-store-mysql` | [`schema.sql`](../tests/pet-store-mysql/schema.sql), [`pet-store-mysql.test.ts`](../tests/pet-store-mysql/pet-store-mysql.test.ts) | Dialect-specific MySQL behavior. |
| `tests/pet-store-sqlite` | [`schema.sql`](../tests/pet-store-sqlite/schema.sql), [`pet-store-sqlite.test.ts`](../tests/pet-store-sqlite/pet-store-sqlite.test.ts) | SQLite-specific generation and migration behavior. |
| `tests/pet-store-mssql` | [`schema.sql`](../tests/pet-store-mssql/schema.sql), [`pet-store-mssql.test.ts`](../tests/pet-store-mssql/pet-store-mssql.test.ts) | MSSQL-specific inspection and generated outputs. |
| `tests/postgraphile-kitchensink` | [`kitchen-sink-schema.sql`](../tests/postgraphile-kitchensink/kitchen-sink-schema.sql), [`kitchen-sink.test.ts`](../tests/postgraphile-kitchensink/kitchen-sink.test.ts) | Rich PostGraphile tagging fixture. |
| `tests/pagila` | [`pagila-schema.sql`](../tests/pagila/pagila-schema.sql), [`pagila.test.ts`](../tests/pagila/pagila.test.ts) | Larger schema coverage. |
| `tests/sakila-mssql` | [`schema.sql`](../tests/sakila-mssql/schema.sql), [`sakila-mssql.test.ts`](../tests/sakila-mssql/sakila-mssql.test.ts) | Another MSSQL integration fixture. |

## High-Signal Test Files

- [`tests/__tests__/workflows/cli-workflows.test.ts`](../tests/__tests__/workflows/cli-workflows.test.ts): best “new user” walkthrough of `init`, `codegen`, `schema inspect`, and generated outputs.
- [`tests/__tests__/pipeline.test.ts`](../tests/__tests__/pipeline.test.ts): direct namespace/plugin compile assertions.
- [`packages/inspector/src/__tests__/snapshot-comparison.test.ts`](../packages/inspector/src/__tests__/snapshot-comparison.test.ts): good when inspector output changes unexpectedly.
- Package-local namespace tests under `packages/ns-*/src/__tests__`: best source for tag-by-tag expected SQL.

## Generated Fixture Output

Committed generated files under fixture directories are deliberate breadcrumbs, not noise. They show the expected output shape for:

- `generated/types.ts`
- `generated-all/*`
- `docs/schema.html`
- `migrations/*.sql`

If a generated file changes, compare it back to:

1. the fixture schema,
2. the relevant namespace or template package,
3. the CLI command that produced it.

## Update Breadcrumbs

- Revisit this doc when a new fixture project is added or when a major workflow test moves.
- If a package gains tests but lacks mention here, add its most useful “read me first” test file.
