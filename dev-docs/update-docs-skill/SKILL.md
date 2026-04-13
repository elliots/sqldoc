# Update Agent Docs

Use this skill when you need to generate or update the repo architecture docs under `dev-docs/`.

## Goal

Keep `dev-docs/` useful for a later agent that needs to:

- find the right doc quickly from a repo path,
- understand the high-level data flow before reading code,
- drill down from docs to the exact source files and tests that matter,
- see which commit the summary was last reviewed against,
- know what changed enough to require a doc refresh.

## Required Outputs

Always maintain:

1. `dev-docs/file-index.md`
2. one or more focused markdown docs that cover the touched paths
3. `Last reviewed commit` metadata in each updated doc
4. `Update breadcrumbs` in each updated doc

## Default Workflow

1. Read `dev-docs/file-index.md` and the docs already mapped to the touched paths.
2. Get the current commit with `git rev-parse HEAD`.
3. Determine scope:
   - For changed existing code, start from `git diff --name-only`.
   - For initial generation or large refactors, inventory the repo by package and top-level directory.
4. Read the real code, not just package names:
   - `package.json`
   - package `src/index.ts`
   - key internal files
   - representative tests
   - related site/data extractors if docs pages are generated from source
5. Update or add docs so each path points to one “best first” doc.
6. Add direct source links for the next read:
   - entry points
   - important helpers
   - highest-signal tests
7. Update `dev-docs/file-index.md` so the new or changed paths resolve to the right doc.

## How Much To Read

For a small change:

- read the changed file,
- read its public entry point,
- read the nearest tests,
- update only the affected docs.

For a large or unfamiliar area:

- read the package `package.json`,
- read `src/index.ts`,
- read the key internal files that own the flow,
- read at least one representative test or fixture,
- update the area doc and any higher-level overview docs affected by the change.

## Documentation Shape

Prefer docs that are easy to scan:

- Start with covered paths.
- Include `Last reviewed commit`.
- Include related docs.
- Explain the area’s role in the larger repo flow.
- Link directly to the most important source files and tests.
- End with `Update breadcrumbs`.

Use Mermaid only when the diagram clarifies data flow better than prose.

## Index Rules

`dev-docs/file-index.md` should stay machine-friendly:

- one mapping per line,
- repo path first,
- markdown link second,
- use the highest useful path when possible,
- add file-level entries for especially important hot spots,
- multiple paths may point to the same doc.

## Update Triggers

Refresh docs when:

- a new package, template, command, or namespace is added,
- a public flow changes between runtime/core/schema/output layers,
- tests or fixtures become the new canonical example for an area,
- site extractors or release scripts drift from source layout.

## Repo-Specific Breadcrumbs

When documenting sqldoc, these files are usually the highest-signal starting points:

- `packages/sqldoc/src/index.ts`
- `packages/cli/src/index.ts`
- `packages/cli/src/utils/pipeline.ts`
- `packages/core/src/compiler/compile.ts`
- `packages/db/src/index.ts`
- `packages/inspector/src/inspector.ts`
- `dev-docs/inspector-dialects.md`
- `packages/templates/src/helpers/enrich.ts`
- `tests/__tests__/workflows/cli-workflows.test.ts`
- `tests/pet-store-postgres/pet-store.test.ts`

## Done Condition

You are done when:

- every touched path has an obvious doc in `file-index.md`,
- the doc points to the right code and tests,
- commit metadata is current,
- higher-level docs were updated if the architecture story changed.
