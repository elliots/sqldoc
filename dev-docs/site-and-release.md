# Site And Release Tooling

- Paths covered: `site`, `scripts`, selected root metadata files
- Last reviewed commit: `9571d50fee5356b058cec0247aa5189272b53de6`
- Related docs: [project-output.md](./project-output.md), [repo-overview.md](./repo-overview.md)

This part of the repo turns source metadata and fixture output into published docs and release artifacts. It is not on the request path for most CLI behavior changes, but it matters when a package or template is added and the docs site or release process needs to stay in sync.

## `site`

| Path | Purpose |
| --- | --- |
| [`site/package.json`](../site/package.json) | Defines site `dev`, `generate`, `build`, and `preview` flows. |
| [`site/guide`](../site/guide) | Handwritten user docs for installation, compilation, configuration, imports, tags, dialects, and connection URLs. |
| [`site/templates`](../site/templates) | Template reference pages driven by extracted metadata. |
| [`site/namespaces`](../site/namespaces) | Namespace reference pages driven by extracted metadata. |
| [`site/examples`](../site/examples) | Example SQL/config used to build homepage and docs examples. |

The `site` build is coupled to the monorepo in two ways:

- It runs repo scripts to regenerate CLI reference and example output.
- It reads source code through `site/data/*` extractors, documented in [project-output.md](./project-output.md).

## Release Scripts

| Script | Purpose |
| --- | --- |
| [`scripts/build-binary.sh`](../scripts/build-binary.sh) | Builds the standalone `sqldoc` binary. |
| [`scripts/release.sh`](../scripts/release.sh) | High-level release workflow. |
| [`scripts/release-binary.sh`](../scripts/release-binary.sh) | Binary-specific release steps. |
| [`scripts/npm-publish.sh`](../scripts/npm-publish.sh) | npm publication flow. |
| [`scripts/bump-version.sh`](../scripts/bump-version.sh) | Version bump automation. |
| [`scripts/changelog.sh`](../scripts/changelog.sh) | Changelog generation/update helper. |

Read these together with:

- [`package.json`](../package.json)
- [`CHANGELOG.md`](../CHANGELOG.md)

## Root Metadata Files Worth Knowing

| File | Why it matters |
| --- | --- |
| [`README.md`](../README.md) | Short public positioning statement. |
| [`CLAUDE.md`](../CLAUDE.md) | Dense repo summary and conventions; useful as coarse context, but not a substitute for `dev-docs`. |
| [`biome.json`](../biome.json) | Formatting/lint expectations. |
| [`lefthook.yml`](../lefthook.yml) | Git hook behavior. |

## Update Breadcrumbs

- Revisit this doc when site build commands change, when a new extracted docs page type is added, or when release/publish scripts change.
- If a new package or template is added but does not appear on the site, inspect `site/data` extractors first.
