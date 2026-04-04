# Changelog

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