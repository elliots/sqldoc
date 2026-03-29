import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { expect } from '@sqldoc/test-utils'
import type { ParsedMigration } from '../utils/migration-formats.ts'
import { concatUpScripts, readMigrations, sanitizeName, writeMigration } from '../utils/migration-formats.ts'

describe('readMigrations', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-formats-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array when directory does not exist', () => {
    expect(readMigrations(path.join(tmpDir, 'nonexistent'), 'plain')).toEqual([])
  })

  // -- plain format --

  describe('plain format', () => {
    it('reads entire file as up SQL', () => {
      const dir = path.join(tmpDir, 'plain')
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, '001_init.sql'), 'CREATE TABLE users (id INT);')

      const result = readMigrations(dir, 'plain')
      expect(result).toHaveLength(1)
      expect(result[0].up).toBe('CREATE TABLE users (id INT);')
      expect(result[0].down).toBe(undefined)
      expect(result[0].sortKey).toBe('001')
    })

    it('sorts lexicographically', () => {
      const dir = path.join(tmpDir, 'plain')
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, '003_third.sql'), 'SELECT 3;')
      fs.writeFileSync(path.join(dir, '001_first.sql'), 'SELECT 1;')
      fs.writeFileSync(path.join(dir, '002_second.sql'), 'SELECT 2;')

      const result = readMigrations(dir, 'plain')
      expect(result.map((m) => m.filename)).toEqual(['001_first.sql', '002_second.sql', '003_third.sql'])
    })
  })

  // -- atlas format --

  describe('atlas format', () => {
    it('reads entire file as up SQL with timestamp sort key', () => {
      const dir = path.join(tmpDir, 'atlas')
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, '20260322120000_init.sql'), 'CREATE TABLE users (id SERIAL);')

      const result = readMigrations(dir, 'atlas')
      expect(result).toHaveLength(1)
      expect(result[0].up).toBe('CREATE TABLE users (id SERIAL);')
      expect(result[0].sortKey).toBe('20260322120000')
      expect(result[0].down).toBe(undefined)
    })
  })

  // -- goose format --

  describe('goose format', () => {
    it('extracts up and down sections', () => {
      const dir = path.join(tmpDir, 'goose')
      fs.mkdirSync(dir)
      fs.writeFileSync(
        path.join(dir, '001_init.sql'),
        `-- +goose Up
CREATE TABLE users (id INT);

-- +goose Down
DROP TABLE users;
`,
      )

      const result = readMigrations(dir, 'goose')
      expect(result).toHaveLength(1)
      expect(result[0].up).toBe('CREATE TABLE users (id INT);')
      expect(result[0].down).toBe('DROP TABLE users;')
    })

    it('handles file with only up section', () => {
      const dir = path.join(tmpDir, 'goose')
      fs.mkdirSync(dir)
      fs.writeFileSync(
        path.join(dir, '001_init.sql'),
        `-- +goose Up
CREATE TABLE users (id INT);
`,
      )

      const result = readMigrations(dir, 'goose')
      expect(result[0].up).toBe('CREATE TABLE users (id INT);')
      expect(result[0].down).toBe(undefined)
    })

    it('handles multi-statement up and down', () => {
      const dir = path.join(tmpDir, 'goose')
      fs.mkdirSync(dir)
      fs.writeFileSync(
        path.join(dir, '002_multi.sql'),
        `-- +goose Up
CREATE TABLE a (id INT);
CREATE TABLE b (id INT);

-- +goose Down
DROP TABLE b;
DROP TABLE a;
`,
      )

      const result = readMigrations(dir, 'goose')
      expect(result[0].up).toContain('CREATE TABLE a')
      expect(result[0].up).toContain('CREATE TABLE b')
      expect(result[0].down!).toContain('DROP TABLE b')
      expect(result[0].down!).toContain('DROP TABLE a')
    })
  })

  // -- golang-migrate format --

  describe('golang-migrate format', () => {
    it('pairs .up.sql and .down.sql files', () => {
      const dir = path.join(tmpDir, 'golang-migrate')
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, '001_init.up.sql'), 'CREATE TABLE users (id INT);')
      fs.writeFileSync(path.join(dir, '001_init.down.sql'), 'DROP TABLE users;')

      const result = readMigrations(dir, 'golang-migrate')
      expect(result).toHaveLength(1)
      expect(result[0].up).toBe('CREATE TABLE users (id INT);')
      expect(result[0].down).toBe('DROP TABLE users;')
      expect(result[0].filename).toBe('001_init.up.sql')
    })

    it('handles missing .down.sql', () => {
      const dir = path.join(tmpDir, 'golang-migrate')
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, '001_init.up.sql'), 'CREATE TABLE users (id INT);')

      const result = readMigrations(dir, 'golang-migrate')
      expect(result).toHaveLength(1)
      expect(result[0].up).toBe('CREATE TABLE users (id INT);')
      expect(result[0].down).toBe(undefined)
    })

    it('handles multiple migration pairs', () => {
      const dir = path.join(tmpDir, 'golang-migrate')
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, '001_init.up.sql'), 'CREATE TABLE a;')
      fs.writeFileSync(path.join(dir, '001_init.down.sql'), 'DROP TABLE a;')
      fs.writeFileSync(path.join(dir, '002_add_b.up.sql'), 'CREATE TABLE b;')
      fs.writeFileSync(path.join(dir, '002_add_b.down.sql'), 'DROP TABLE b;')

      const result = readMigrations(dir, 'golang-migrate')
      expect(result).toHaveLength(2)
      expect(result[0].sortKey).toBe('001')
      expect(result[1].sortKey).toBe('002')
    })
  })

  // -- flyway format --

  describe('flyway format', () => {
    it('reads V files as up and pairs with U files for down', () => {
      const dir = path.join(tmpDir, 'flyway')
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, 'V1__init.sql'), 'CREATE TABLE users (id INT);')
      fs.writeFileSync(path.join(dir, 'U1__init.sql'), 'DROP TABLE users;')

      const result = readMigrations(dir, 'flyway')
      expect(result).toHaveLength(1)
      expect(result[0].up).toBe('CREATE TABLE users (id INT);')
      expect(result[0].down).toBe('DROP TABLE users;')
      expect(result[0].filename).toBe('V1__init.sql')
    })

    it('handles missing U file', () => {
      const dir = path.join(tmpDir, 'flyway')
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, 'V1__init.sql'), 'CREATE TABLE users (id INT);')

      const result = readMigrations(dir, 'flyway')
      expect(result[0].down).toBe(undefined)
    })

    it('reads multiple versions in order', () => {
      const dir = path.join(tmpDir, 'flyway')
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, 'V2__second.sql'), 'SELECT 2;')
      fs.writeFileSync(path.join(dir, 'V1__first.sql'), 'SELECT 1;')
      fs.writeFileSync(path.join(dir, 'V3__third.sql'), 'SELECT 3;')

      const result = readMigrations(dir, 'flyway')
      // Files are sorted lexicographically from the directory
      expect(result.map((m) => m.filename)).toEqual(['V1__first.sql', 'V2__second.sql', 'V3__third.sql'])
    })
  })

  // -- dbmate format --

  describe('dbmate format', () => {
    it('extracts up and down sections', () => {
      const dir = path.join(tmpDir, 'dbmate')
      fs.mkdirSync(dir)
      fs.writeFileSync(
        path.join(dir, '001_init.sql'),
        `-- migrate:up
CREATE TABLE users (id INT);

-- migrate:down
DROP TABLE users;
`,
      )

      const result = readMigrations(dir, 'dbmate')
      expect(result).toHaveLength(1)
      expect(result[0].up).toBe('CREATE TABLE users (id INT);')
      expect(result[0].down).toBe('DROP TABLE users;')
    })

    it('handles file with only up section', () => {
      const dir = path.join(tmpDir, 'dbmate')
      fs.mkdirSync(dir)
      fs.writeFileSync(
        path.join(dir, '001_init.sql'),
        `-- migrate:up
CREATE TABLE users (id INT);
`,
      )

      const result = readMigrations(dir, 'dbmate')
      expect(result[0].up).toBe('CREATE TABLE users (id INT);')
      expect(result[0].down).toBe(undefined)
    })
  })
})

// -- writeMigration --

describe('writeMigration', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-write-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates directory if it does not exist', () => {
    const dir = path.join(tmpDir, 'new', 'nested')
    writeMigration({
      dir,
      name: 'init',
      up: 'CREATE TABLE t;',
      format: 'plain',
      naming: 'timestamp',
    })
    expect(fs.existsSync(dir)).toBe(true)
  })

  describe('plain format', () => {
    it('writes timestamp-prefixed file', () => {
      const dir = path.join(tmpDir, 'plain')
      const files = writeMigration({
        dir,
        name: 'add_users',
        up: 'CREATE TABLE users (id INT);',
        format: 'plain',
        naming: 'timestamp',
      })

      expect(files).toHaveLength(1)
      const filename = path.basename(files[0])
      expect(filename).toMatch(/^\d{14}_add_users\.sql$/)
      expect(fs.readFileSync(files[0], 'utf-8')).toBe('CREATE TABLE users (id INT);\n')
    })

    it('writes sequential-prefixed file', () => {
      const dir = path.join(tmpDir, 'plain')
      const files = writeMigration({
        dir,
        name: 'add_users',
        up: 'CREATE TABLE users;',
        format: 'plain',
        naming: 'sequential',
        existing: [],
      })

      const filename = path.basename(files[0])
      expect(filename).toBe('001_add_users.sql')
    })

    it('increments sequential prefix from existing', () => {
      const dir = path.join(tmpDir, 'plain')
      const existing: ParsedMigration[] = [
        { filename: '001_init.sql', up: '', sortKey: '001' },
        { filename: '002_add_a.sql', up: '', sortKey: '002' },
      ]
      const files = writeMigration({
        dir,
        name: 'add_b',
        up: 'CREATE TABLE b;',
        format: 'plain',
        naming: 'sequential',
        existing,
      })

      expect(path.basename(files[0])).toBe('003_add_b.sql')
    })
  })

  describe('goose format', () => {
    it('writes file with goose markers', () => {
      const dir = path.join(tmpDir, 'goose')
      const files = writeMigration({
        dir,
        name: 'init',
        up: 'CREATE TABLE users (id INT);',
        down: 'DROP TABLE users;',
        format: 'goose',
        naming: 'timestamp',
      })

      const content = fs.readFileSync(files[0], 'utf-8')
      expect(content).toContain('-- +goose Up')
      expect(content).toContain('CREATE TABLE users (id INT);')
      expect(content).toContain('-- +goose Down')
      expect(content).toContain('DROP TABLE users;')
    })

    it('omits down section when no down SQL', () => {
      const dir = path.join(tmpDir, 'goose')
      const files = writeMigration({
        dir,
        name: 'init',
        up: 'CREATE TABLE users;',
        format: 'goose',
        naming: 'timestamp',
      })

      const content = fs.readFileSync(files[0], 'utf-8')
      expect(content).toContain('-- +goose Up')
      expect(content).not.toContain('-- +goose Down')
    })
  })

  describe('golang-migrate format', () => {
    it('writes separate .up.sql and .down.sql files', () => {
      const dir = path.join(tmpDir, 'golang-migrate')
      const files = writeMigration({
        dir,
        name: 'init',
        up: 'CREATE TABLE users;',
        down: 'DROP TABLE users;',
        format: 'golang-migrate',
        naming: 'timestamp',
      })

      expect(files).toHaveLength(2)
      expect(files[0]).toMatch(/\.up\.sql$/)
      expect(files[1]).toMatch(/\.down\.sql$/)
      expect(fs.readFileSync(files[0], 'utf-8')).toBe('CREATE TABLE users;\n')
      expect(fs.readFileSync(files[1], 'utf-8')).toBe('DROP TABLE users;\n')
    })

    it('writes only .up.sql when no down SQL', () => {
      const dir = path.join(tmpDir, 'golang-migrate')
      const files = writeMigration({
        dir,
        name: 'init',
        up: 'CREATE TABLE users;',
        format: 'golang-migrate',
        naming: 'timestamp',
      })

      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/\.up\.sql$/)
    })
  })

  describe('flyway format', () => {
    it('writes V and U files', () => {
      const dir = path.join(tmpDir, 'flyway')
      const files = writeMigration({
        dir,
        name: 'init',
        up: 'CREATE TABLE users;',
        down: 'DROP TABLE users;',
        format: 'flyway',
        naming: 'sequential',
        existing: [],
      })

      expect(files).toHaveLength(2)
      expect(path.basename(files[0])).toBe('V1__init.sql')
      expect(path.basename(files[1])).toBe('U1__init.sql')
    })

    it('increments flyway version from existing', () => {
      const dir = path.join(tmpDir, 'flyway')
      const existing: ParsedMigration[] = [
        { filename: 'V1__init.sql', up: '', sortKey: '000001' },
        { filename: 'V2__add_a.sql', up: '', sortKey: '000002' },
      ]
      const files = writeMigration({
        dir,
        name: 'add_b',
        up: 'CREATE TABLE b;',
        format: 'flyway',
        naming: 'sequential',
        existing,
      })

      expect(path.basename(files[0])).toBe('V3__add_b.sql')
    })
  })

  describe('dbmate format', () => {
    it('writes file with dbmate markers', () => {
      const dir = path.join(tmpDir, 'dbmate')
      const files = writeMigration({
        dir,
        name: 'init',
        up: 'CREATE TABLE users;',
        down: 'DROP TABLE users;',
        format: 'dbmate',
        naming: 'timestamp',
      })

      const content = fs.readFileSync(files[0], 'utf-8')
      expect(content).toContain('-- migrate:up')
      expect(content).toContain('CREATE TABLE users;')
      expect(content).toContain('-- migrate:down')
      expect(content).toContain('DROP TABLE users;')
    })
  })
})

// -- sanitizeName --

describe('sanitizeName', () => {
  it('lowercases and replaces non-alphanum with underscore', () => {
    expect(sanitizeName('Add User Table!')).toBe('add_user_table')
  })

  it('strips leading and trailing underscores', () => {
    expect(sanitizeName('--hello--')).toBe('hello')
  })

  it('defaults to "migration" when empty', () => {
    expect(sanitizeName('')).toBe('migration')
    expect(sanitizeName('---')).toBe('migration')
  })
})

// -- concatUpScripts --

describe('concatUpScripts', () => {
  it('concatenates up scripts with double newlines', () => {
    const migrations: ParsedMigration[] = [
      { filename: '001.sql', up: 'CREATE TABLE a;', sortKey: '001' },
      { filename: '002.sql', up: 'CREATE TABLE b;', sortKey: '002' },
    ]
    const result = concatUpScripts(migrations)
    expect(result).toBe('CREATE TABLE a;\n\nCREATE TABLE b;')
  })

  it('returns empty string for no migrations', () => {
    expect(concatUpScripts([])).toBe('')
  })
})
