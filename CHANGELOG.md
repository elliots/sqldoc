# Changelog

## v0.2.4 (2026-04-21)

b54282c feat: caching in diff

## v0.2.3 (2026-04-21)

ffde928 feat: cli: compile/inspect caching
48861d8 fix: inspector: postgres trigger ordering

## v0.2.2 (2026-04-21)

cac2951 fix: dep bin loader

## v0.2.1 (2026-04-21)

5f61a55 feat: support running cli as a dep, not just all-in-one binary

## v0.2.0 (2026-04-20)

f62f7e29 mssql: initial version
915caa45 refactor: shadow databases + parallel diff via DbSource

f4db36ad fix: strip default schema qualifier at generation time
a553fe08 fix: review issues
ba0f92c6 fix: kysely: function return type
788a2003 fix: schema in comment parsing
2a87b6c4 fix: dont emit externals in compile by default
2f72058c fix: key loadLocalPlugins cache by (loader, sqldocDir)
becb3e1b test: update ns-postgraphile comment-body escape expectations
be68a2c1 refactor: drop MySQL/SQLite from ns-comment
465c307a fix: more auto-fixes
1c70b0df refactor: migrate audit/history/softdelete/temporal/validate to per-tag handlers
3a46289d refactor: add defineNamespace helper, local plugin registry, and info-severity errors
f1e034f0 chore: pr comment fixes
0d26d15b fix: db: dont swallow validation error on close error
36e8682d refactor: core: expose engine across plugin contexts
79130eb0 refactor: api: make engine the public database selector
8aa19b90 refactor: cli: make project configs engine-aware
c326c9bd refactor: model database engines explicitly
e87b48d6 refactor(core): scope schema-aware compile by file
9042d30f fix: core: make block resolution forward-only
df18b230 fix: respect object kinds and schema-qualified pk lint
52944dee fix: tighten tag merging and verification checks
e7edacdb fix: inspector: preserve delimiter directive positions
5f731671 refactor: ns-docs: use canonical realm model
e74ee57d refactor: core: unify schema types and postgres ast
d18eac92 refactor: centralize db adapter runtime
acaeac63 refactor: centralize inspector dialect runtime
c63878be refactor: normalize tier2 schema access
e6be3f80 inspector: remove file directives
f0ee67e4 refactor: centralize ast adapter selection
8af77fea refactor: remove atlas runtime naming
a971170b refactor: centralize dialect defaults
3fd8b05b fix: stabilize mssql and inspector checks
048d3c68 docs: add development workflow guide
2721e009 chore: add test:node:coverage script
37e8e37f fix: db: optional mssql docker container reuse
16b89cd6 fix: fixes from review
e0cb6f25 feat: add dev-docs
39ba00fc fix: normalize schema on inspection - strip current schema from objects for portable diffs
912cc4e7 fix: withCascade for Postgres restore, IF EXISTS on all drops, version checks, reply all PR comments
7f050aa4 test: add regression tests for all review fixes
b5056f72 fix: MySQL modify_check, drop_attr clearing, addView guard, test type safety
6e5ec66c chore: require node 25 in engines
42e680cc fix: enable TLS encryption by default for MSSQL connections
31c49b93 fix: MSSQL escaping/injection, aggregate overloads, quote validation, exec args, async docker wait
93467711 fix: move drop_schema to dependency-ordered drop array instead of prelude
f4c89130 fix: schema-qualified plan keys, PG identity/collation DDL, cache stmtDecls, remove dead code
7eb264c6 fix: column rename SQL, readonly File, general restore, MySQL/MSSQL version detection
b2804a1d fix: detect currentSchema from DB connection, stamp on Realm
0d94d246 fix: centralize defaultSchema on Realm, remove duplicated dialect logic
11d3935d fix: revert batch fallback and topComments changes that broke tests
10d91589 fix: single-schema realms use actual schema name as default
6266e92a fix: multi-schema object identity in compiler, enricher, and renames
5ebb209e chore: lint
3ea20c5f fix: close db adapter in MySQL test after hook
67a36827 fix: snapshot restore in finally, validate exclude patterns, stop topComments at non-comment
2f96b0c2 fix: view comment removal, generated column additions, predicate normalization, xml type
8821029e fix: escape rename identifiers, MySQL boolean/quote correctness
f62f7e29 mssql: initial version
e927c26e test: domain migration preserves NOT NULL, type size, and detects changes
b61aab3f chore: biome formatting
5acd1e82 fix: domain diff comparison and migration DDL (NOT NULL, type size)
812579fa fix: strengthen test assertions
88bc090b fix: improve dev database safety and dependency matching
c70e6919 fix: scope column-level tags to their own column in compiler
2f6dce9c fix: complete TiDB priority coverage for all table-level change types
0db4c5d8 fix: harden external object immutability checks
fa527253 fix: improve parsing robustness across dialects
44450268 fix: detect generated column expression changes in postgres diff
540e4633 fix: improve bitmask type safety for InspectMode and DiffMode
4a555d85 fix: use TiDB-specific classes when tidb option is set, validate exclude depth
61cac574 fix: add typecheck script to inspector and fix MySQL test assertions
c21f34b4 fix: improve type safety for ChangeKind and PipelineResult.atlasRealm
2386e620 fix: remove dead code and improve readability
8c955cbc fix: missing destructive/diff detection for drop_schema, op-class, range/aggregate
f2fd7fc2 fix: escape identifiers and literals in SQL generation
3e34d406 fix: more inspector fixes, all tests passing again
0e3348cb inspector: use and fix and test
5c16989a inspector: port from go
cf27e52c fix: diffing individual schemas


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