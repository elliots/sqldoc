# Changelog

## v0.1.3 (2026-04-09)

a61b6be fix: handle composite return types from functions
bf8a190 fix: file order with imports/externals

## v0.1.2 (2026-04-09)

e3a8c99 fix: remove node_modules .ts import guard - type stripping hooks handle it

## v0.1.1 (2026-04-09)

9d94eee7 feat: templates: php-eloquent, ruby-activerecord, swift-codable
bcd1b547 feat: ns-history, ns-temporal, and ns-softdelete
16aaebac feat: expose column precision, scale, and size from inspection
fb46bb86 fix: deduplicate MaxLength attributes in EF Core template
66c40d78 fix: swallow db.close() errors to preserve original runner failure
deefb004 fix: correct ns-temporal doc comments for DELETE behavior and SQLite
7bb1fc4b fix: close adapter if runner creation fails
27b1ea15 fix: extract nested template literals in ns-temporal
e57f509a fix: use ENV.fetch in Ruby test to validate DATABASE_URL
d1703dfb fix: add scale to decimal cast in PHP Eloquent test fixture
c84eb8f4 fix: cascade reads config.column fallback for soft-delete column name
bd1e32fd fix: escape backslashes and Ruby interpolation in activerecord output
8fa57682 fix: reject Docker dev URLs for unsupported dialects like sqlite
c5d2b48d fix: coerce null to undefined for doctor detail functions
5d269f8d fix: update softdelete tests for FK-qualified trigger names
fb064240 fix: simplify FK null check with optional chaining
d3ddfa9d fix: use execFileSync for docker build/run in template tests
a9b9bd0e fix: detect Json usage in functions for knex template
52c2217a fix: use Regexp.new for Ruby pattern validation
9b323795 fix: quote Ruby enum keys for values with hyphens/spaces
6d8c857b fix: ensure RESET ROLE runs even if RLS assertions fail
4a6a4af8 fix: use wrapper types for JPA @Id fields
8fe11fe0 fix: include scale suffix in Eloquent decimal cast
254585d6 fix: propagate NOT NULL to JPA @ManyToOne/@JoinColumn annotations
2e1f4d50 fix: handle composite columns in Swift Codable view rendering
89f99bd8 fix: emit Json type declaration in knex template
f43e6979 fix: use createRequire instead of bare require in ESM delegate
de4655c3 fix: use execFileSync for codegen in docker template tests
24cdef65 fix: use strict boolean comparison in PHP Eloquent test
5c18d10b fix: correct stale output path in generate-all-templates.sh
4e88c779 fix: escape regex delimiters in Ruby ActiveRecord pattern validation
702aa361 fix: reject composite foreign keys in softdelete cascade
8b6e2c45 fix: use WHEN clause for SQLite softdelete cascade triggers
bf94ae9a fix: make softdelete cascade trigger names unique per FK column
aad64bf8 fix: prevent invalid ?mixed in generated PHP types
de8ccd38 fix: use Number.parseInt and [[ conditionals across project
d3395e4c fix: scripts: use [[ instead of [ for conditionals
8f1188a4 fix: cli: extract nested ternaries, use Number.parseInt, .at()
e9ac770c fix: templates: use localeCompare in sort, replaceAll, optional chaining

## v0.1.0 (2026-04-07)
 - feat: bundle with node (SEA) + aborist instead of bun compile
 - feat: use fossilize for cross-platform binary builds
 - feat: show embedded Node.js version in --version output

## v0.0.10 (2026-04-06)
 - feat: db: replace pg with postgres.js
 - feat: cli: handle multiple configs in file
 - feat: use Bun built-in SQL drivers, skip npm drivers on Bun
 - feat: database adapter plugins
 - feat: db-neon-temporary: fires up a temporary Neon database, as an alternative to pglite or docker
 - feat: db-neon: connect to neon db instance using websocket. much todo there.
 - feat: drop number of roundtrips to postgres during inspection
 - fix: lots of tiny fixes from static analysis

## v0.0.9 (2026-04-04)
 - feat: move bundle-require from core to vscode extension
 - feat: replace fast-glob with built-in fs.globSync

## v0.0.8 (2026-04-04)
 - feat: --all flag to run commands across all workspace configs
 - feat: replace testcontainers with direct docker cli
 - feat: improve typing in typescript templates
 - fix: postgres: only include roles with oid >= 16384 
 - fix: postgres: identity column sequences not recognized as auto-owned (deptype 'i')

## v0.0.7 (2026-04-03)
 - chore: more publish issues

## v0.0.6 (2026-04-03)
 - feat: multi-schema support
 - fix: monorepo support - one .sqldoc dir, many configs

## v0.0.5 (2026-04-03)
 - chore: more publish issues

## v0.0.4 (2026-04-03)
 - chore: publish with bun to fix catalog: deps

## v0.0.3 (2026-04-02)
 - feat: docs
 - feat: @external/@include directives
 - test: pet-store E2E integration tests
 - chore: remove pnpm, use bun for package management
 - chore: migrate all tests from vitest to built-in node/bun test