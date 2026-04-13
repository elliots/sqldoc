# Development Workflow

- Paths covered: `package.json`, repo-wide checks, repo-wide test commands
- Last reviewed commit: `fe6b77e71474cabfa8f22d30520ff33ac951b90c`
- Related docs: [repo-overview.md](./repo-overview.md), [testing-and-fixtures.md](./testing-and-fixtures.md), [schema-engine.md](./schema-engine.md)

Use this doc when you need the day-to-day workflow rather than architecture. It captures the baseline checks the repo expects before commits and the test-running habits that keep failures readable.

## Before Each Commit

Run these before every commit:

1. `bun run check`
2. `bun run test:node`

If `check` needs to rewrite code, use `bun run check:fix` and then rerun `bun run check`.

## End Of Work

Run `bun run test:bun` at the end of the full task. It takes longer, so it is the final repo-wide verification pass rather than the fast loop before every commit.

## Test Output Handling

Do not read large test output directly from the terminal scrollback. Pipe it to a temp file, then inspect the file.

Example pattern:

```sh
tmpfile=$(mktemp /tmp/sqldoc-test-node.XXXXXX.txt)
bun run test:node >"$tmpfile" 2>&1
sed -n '1,220p' "$tmpfile"
```

Use the same pattern for `bun run check`, `bun run test:bun`, or any targeted test command.

## Running Individual Tests

Prefer Node for individual test files, even if the full suite will later run under Bun as well.

- Use `node --test <path-to-test>` for one file or a narrow set of files.
- If the test is slow, add a higher timeout such as `node --test --test-timeout=120000 <path-to-test>`.
- Pipe the output to a temp file first, then inspect the file.

Example:

```sh
tmpfile=$(mktemp /tmp/sqldoc-one-test.XXXXXX.txt)
node --test --test-timeout=120000 packages/inspector/src/__tests__/mssql/inspect.test.ts >"$tmpfile" 2>&1
sed -n '1,220p' "$tmpfile"
```

## Commit Shape

- Commit in sensible stages instead of batching unrelated work together.
- Make sure the relevant checks pass before each commit.
- Run the slower Bun-wide test pass after the full task is assembled.

## Update Breadcrumbs

- Revisit this doc if the top-level `package.json` scripts change.
- Update the command examples if the preferred Node test flags change.
- Keep this aligned with any future commit or CI workflow guidance added to the repo.
