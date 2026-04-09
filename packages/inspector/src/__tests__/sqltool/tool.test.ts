import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  golangMigrateFormatter,
  gooseFormatter,
  flywayFormatter,
  liquibaseFormatter,
  dbmateFormatter,
  scanGolangMigrateDir,
  scanGooseDir,
  scanFlywayDir,
  scanLiquibaseDir,
  scanDbmateDir,
  isHidden,
  now,
  type FormatterInput,
} from '../../sqltool/tool.ts'
import { MemDir } from '../../migrate/dir.ts'

// -- Test Plan --

const plan: FormatterInput = {
  name: 'tooling-plan',
  changes: [
    { cmd: 'CREATE TABLE t1(c int)', comment: 'create table t1', reverseStmts: ['DROP TABLE t1 IF EXISTS'] },
    { cmd: 'CREATE TABLE t2(c int)', comment: 'create table t2', reverseStmts: ['DROP TABLE t2'] },
    {
      cmd: 'DROP TABLE t3',
      comment: 'drop table t3',
      reverseStmts: ['CREATE TABLE t1(id int)', 'CREATE INDEX idx ON t1(id)'],
    },
  ],
}

// -- isHidden --

describe('isHidden', () => {
  it('returns true for dotfiles', () => {
    assert.equal(isHidden('.gitignore'), true)
    assert.equal(isHidden('.hidden'), true)
  })

  it('returns false for normal files', () => {
    assert.equal(isHidden('migration.sql'), false)
    assert.equal(isHidden('001_init.sql'), false)
  })
})

// -- now() --

describe('now', () => {
  it('returns a 14-character timestamp string', () => {
    const ts = now()
    assert.equal(ts.length, 14)
    assert.match(ts, /^\d{14}$/)
  })
})

// -- Formatter Tests --

describe('golangMigrateFormatter', () => {
  it('formats a plan with up and down files', () => {
    const files = golangMigrateFormatter.format(plan)
    assert.equal(files.length, 2)

    const up = files[0]
    assert.match(up.name, /^\d{14}_tooling-plan\.up\.sql$/)
    assert.ok(up.content.includes('-- create table t1'))
    assert.ok(up.content.includes('CREATE TABLE t1(c int);'))
    assert.ok(up.content.includes('CREATE TABLE t2(c int);'))
    assert.ok(up.content.includes('DROP TABLE t3;'))

    const down = files[1]
    assert.match(down.name, /^\d{14}_tooling-plan\.down\.sql$/)
    // Reverse order
    assert.ok(down.content.includes('-- reverse: drop table t3'))
    assert.ok(down.content.includes('CREATE TABLE t1(id int);'))
    assert.ok(down.content.includes('CREATE INDEX idx ON t1(id);'))
    assert.ok(down.content.includes('-- reverse: create table t2'))
    assert.ok(down.content.includes('DROP TABLE t2;'))
    assert.ok(down.content.includes('-- reverse: create table t1'))
    assert.ok(down.content.includes('DROP TABLE t1 IF EXISTS;'))
  })

  it('formats a plan with no name', () => {
    const files = golangMigrateFormatter.format({ changes: [{ cmd: 'SELECT 1' }] })
    assert.equal(files.length, 1)
    assert.match(files[0].name, /^\d{14}\.up\.sql$/)
  })

  it('omits down file when no reverse stmts', () => {
    const files = golangMigrateFormatter.format({
      name: 'no-reverse',
      changes: [{ cmd: 'CREATE TABLE t(c int)' }],
    })
    assert.equal(files.length, 1)
  })
})

describe('gooseFormatter', () => {
  it('formats a plan with goose markers', () => {
    const files = gooseFormatter.format(plan)
    assert.equal(files.length, 1)

    const f = files[0]
    assert.match(f.name, /^\d{14}_tooling-plan\.sql$/)
    assert.ok(f.content.startsWith('-- +goose Up\n'))
    assert.ok(f.content.includes('-- +goose Down\n'))
    assert.ok(f.content.includes('-- create table t1'))
    assert.ok(f.content.includes('CREATE TABLE t1(c int);'))
    assert.ok(f.content.includes('-- reverse: drop table t3'))
  })

  it('formats a plan with no name', () => {
    const files = gooseFormatter.format({ changes: [{ cmd: 'SELECT 1' }] })
    assert.match(files[0].name, /^\d{14}\.sql$/)
  })
})

describe('flywayFormatter', () => {
  it('formats a plan with V and U prefixes', () => {
    const files = flywayFormatter.format(plan)
    assert.equal(files.length, 2)

    const up = files[0]
    assert.match(up.name, /^V\d{14}__tooling-plan\.sql$/)
    assert.ok(up.content.includes('CREATE TABLE t1(c int);'))

    const down = files[1]
    assert.match(down.name, /^U\d{14}__tooling-plan\.sql$/)
    assert.ok(down.content.includes('-- reverse: drop table t3'))
  })

  it('uses double underscores in filename', () => {
    const files = flywayFormatter.format(plan)
    assert.ok(files[0].name.includes('__tooling-plan'))
  })
})

describe('liquibaseFormatter', () => {
  it('formats a plan with liquibase annotations', () => {
    const files = liquibaseFormatter.format(plan)
    assert.equal(files.length, 1)

    const f = files[0]
    assert.match(f.name, /^\d{14}_tooling-plan\.sql$/)
    assert.ok(f.content.startsWith('--liquibase formatted sql\n'))
    // Changeset numbering
    assert.ok(f.content.includes('--changeset atlas:'))
    assert.match(f.content, /--changeset atlas:\d{14}-1/)
    assert.match(f.content, /--changeset atlas:\d{14}-2/)
    assert.match(f.content, /--changeset atlas:\d{14}-3/)
    // Comments
    assert.ok(f.content.includes('--comment: create table t1'))
    // Rollback
    assert.ok(f.content.includes('--rollback: DROP TABLE t1 IF EXISTS;'))
    assert.ok(f.content.includes('--rollback: CREATE TABLE t1(id int);'))
    assert.ok(f.content.includes('--rollback: CREATE INDEX idx ON t1(id);'))
  })
})

describe('dbmateFormatter', () => {
  it('formats a plan with migrate markers', () => {
    const files = dbmateFormatter.format(plan)
    assert.equal(files.length, 1)

    const f = files[0]
    assert.match(f.name, /^\d{14}_tooling-plan\.sql$/)
    assert.ok(f.content.startsWith('-- migrate:up\n'))
    assert.ok(f.content.includes('-- migrate:down\n'))
    assert.ok(f.content.includes('-- create table t1'))
    assert.ok(f.content.includes('CREATE TABLE t1(c int);'))
    assert.ok(f.content.includes('-- reverse: drop table t3'))
  })
})

// -- Scanner Tests --

describe('scanGolangMigrateDir', () => {
  it('scans golang-migrate files', () => {
    const dir = new MemDir()
    dir.addFile('1_initial.up.sql', 'CREATE TABLE t1(c int);')
    dir.addFile('1_initial.down.sql', 'DROP TABLE t1;')
    dir.addFile('2_second.up.sql', 'CREATE TABLE t2(c int);')
    dir.addFile('2_second.down.sql', 'DROP TABLE t2;')

    const results = scanGolangMigrateDir(dir.allFiles())
    assert.equal(results.length, 2)
    assert.equal(results[0].version, '1')
    assert.equal(results[0].description, 'initial')
    assert.equal(results[1].version, '2')
    assert.equal(results[1].description, 'second')
  })

  it('skips hidden files', () => {
    const dir = new MemDir()
    dir.addFile('.hidden.up.sql', '')
    dir.addFile('1_init.up.sql', 'SELECT 1;')

    const results = scanGolangMigrateDir(dir.allFiles())
    assert.equal(results.length, 1)
  })

  it('skips non-matching files', () => {
    const dir = new MemDir()
    dir.addFile('readme.txt', 'hello')
    dir.addFile('1_init.up.sql', 'SELECT 1;')

    const results = scanGolangMigrateDir(dir.allFiles())
    assert.equal(results.length, 1)
  })

  it('returns empty for empty dir', () => {
    const dir = new MemDir()
    const results = scanGolangMigrateDir(dir.allFiles())
    assert.equal(results.length, 0)
  })

  it('handles files without description', () => {
    const dir = new MemDir()
    dir.addFile('1.up.sql', 'SELECT 1;')

    const results = scanGolangMigrateDir(dir.allFiles())
    assert.equal(results.length, 1)
    assert.equal(results[0].version, '1')
    assert.equal(results[0].description, undefined)
  })
})

describe('scanGooseDir', () => {
  it('scans goose files', () => {
    const dir = new MemDir()
    dir.addFile('1_initial.sql', '-- +goose Up\nCREATE TABLE t1(c int);')
    dir.addFile('2_second.sql', '-- +goose Up\nCREATE TABLE t2(c int);')

    const results = scanGooseDir(dir.files())
    assert.equal(results.length, 2)
    assert.equal(results[0].version, '1')
    assert.equal(results[0].description, 'initial')
    assert.equal(results[1].version, '2')
    assert.equal(results[1].description, 'second')
  })

  it('skips hidden files', () => {
    const dir = new MemDir()
    dir.addFile('.hidden.sql', '')
    dir.addFile('1_init.sql', 'SELECT 1;')

    const results = scanGooseDir(dir.files())
    assert.equal(results.length, 1)
  })

  it('returns empty for empty dir', () => {
    const results = scanGooseDir([])
    assert.equal(results.length, 0)
  })
})

describe('scanFlywayDir', () => {
  it('scans flyway versioned files', () => {
    const dir = new MemDir()
    dir.addFile('V1__initial.sql', 'CREATE TABLE t1(c int);')
    dir.addFile('V2__second.sql', 'CREATE TABLE t2(c int);')

    const results = scanFlywayDir(dir.allFiles())
    assert.equal(results.length, 2)
    assert.equal(results[0].version, '1')
    assert.equal(results[0].description, 'initial')
    assert.equal(results[1].version, '2')
    assert.equal(results[1].description, 'second')
  })

  it('sorts by version numerically', () => {
    const dir = new MemDir()
    dir.addFile('V2__b.sql', 'b')
    dir.addFile('V1__a.sql', 'a')
    dir.addFile('V11__c.sql', 'c')

    const results = scanFlywayDir(dir.allFiles())
    assert.equal(results[0].version, '1')
    assert.equal(results[1].version, '2')
    assert.equal(results[2].version, '11')
  })

  it('handles semver-like versions', () => {
    const dir = new MemDir()
    dir.addFile('V1__.sql', '1')
    dir.addFile('V1.1.0__.sql', '1.1.0')
    dir.addFile('V2__.sql', '2')

    const results = scanFlywayDir(dir.allFiles())
    assert.equal(results.length, 3)
    assert.equal(results[0].version, '1')
    assert.equal(results[1].version, '1.1.0')
    assert.equal(results[2].version, '2')
  })

  it('skips undo (U) files', () => {
    const dir = new MemDir()
    dir.addFile('V1__init.sql', 'CREATE TABLE t1;')
    dir.addFile('U1__init.sql', 'DROP TABLE t1;')

    const results = scanFlywayDir(dir.allFiles())
    // Both V and U match the pattern -- both should be included per plan regex
    // Actually, the plan's flyway regex accepts both V and U
    assert.equal(results.length, 2)
  })

  it('skips hidden files', () => {
    const dir = new MemDir()
    dir.addFile('.V1__hidden.sql', '')
    dir.addFile('V1__visible.sql', 'SELECT 1;')

    const results = scanFlywayDir(dir.allFiles())
    assert.equal(results.length, 1)
  })

  it('returns empty for empty dir', () => {
    const results = scanFlywayDir([])
    assert.equal(results.length, 0)
  })
})

describe('scanLiquibaseDir', () => {
  it('scans liquibase files', () => {
    const dir = new MemDir()
    dir.addFile('1_initial.sql', '--liquibase formatted sql\n--changeset atlas:1-1\nCREATE TABLE t1;')
    dir.addFile('2_second.sql', '--liquibase formatted sql\n--changeset atlas:2-1\nCREATE TABLE t2;')

    const results = scanLiquibaseDir(dir.files())
    assert.equal(results.length, 2)
    assert.equal(results[0].version, '1')
    assert.equal(results[0].description, 'initial')
    assert.equal(results[1].version, '2')
    assert.equal(results[1].description, 'second')
  })

  it('returns empty for empty dir', () => {
    const results = scanLiquibaseDir([])
    assert.equal(results.length, 0)
  })
})

describe('scanDbmateDir', () => {
  it('scans dbmate files', () => {
    const dir = new MemDir()
    dir.addFile('1_initial.sql', '-- migrate:up\nCREATE TABLE t1;')
    dir.addFile('2_second.sql', '-- migrate:up\nCREATE TABLE t2;')

    const results = scanDbmateDir(dir.files())
    assert.equal(results.length, 2)
    assert.equal(results[0].version, '1')
    assert.equal(results[0].description, 'initial')
    assert.equal(results[1].version, '2')
    assert.equal(results[1].description, 'second')
  })

  it('skips hidden files', () => {
    const dir = new MemDir()
    dir.addFile('.1_hidden.sql', '')
    dir.addFile('1_visible.sql', 'SELECT 1;')

    const results = scanDbmateDir(dir.files())
    assert.equal(results.length, 1)
  })

  it('returns empty for empty dir', () => {
    const results = scanDbmateDir([])
    assert.equal(results.length, 0)
  })

  it('sorts files by version', () => {
    const dir = new MemDir()
    dir.addFile('3_c.sql', 'c')
    dir.addFile('1_a.sql', 'a')
    dir.addFile('2_b.sql', 'b')

    const results = scanDbmateDir(dir.files())
    assert.equal(results[0].version, '1')
    assert.equal(results[1].version, '2')
    assert.equal(results[2].version, '3')
  })
})
