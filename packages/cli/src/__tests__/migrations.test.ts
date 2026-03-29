import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { expect } from '@sqldoc/test-utils'
import type { MigrationFile } from '../utils/migrations.ts'
import { migrationFilename, readMigrationDir, writeMigrationFile } from '../utils/migrations.ts'

describe('readMigrationDir', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-migrations-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array when directory does not exist', () => {
    const result = readMigrationDir(path.join(tmpDir, 'nonexistent'))
    expect(result).toEqual([])
  })

  it('returns .sql files sorted lexicographically', () => {
    const dir = path.join(tmpDir, 'migrations')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, '20260322090000_second.sql'), 'CREATE TABLE b;')
    fs.writeFileSync(path.join(dir, '20260321143000_first.sql'), 'CREATE TABLE a;')
    fs.writeFileSync(path.join(dir, '20260323110000_third.sql'), 'CREATE TABLE c;')

    const result = readMigrationDir(dir)
    expect(result).toHaveLength(3)
    expect(result[0].filename).toBe('20260321143000_first.sql')
    expect(result[1].filename).toBe('20260322090000_second.sql')
    expect(result[2].filename).toBe('20260323110000_third.sql')
  })

  it('ignores non-.sql files', () => {
    const dir = path.join(tmpDir, 'migrations')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, '20260321143000_first.sql'), 'CREATE TABLE a;')
    fs.writeFileSync(path.join(dir, 'README.md'), '# Migrations')
    fs.writeFileSync(path.join(dir, 'atlas.sum'), 'checksum')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'some notes')

    const result = readMigrationDir(dir)
    expect(result).toHaveLength(1)
    expect(result[0].filename).toBe('20260321143000_first.sql')
  })

  it('returns MigrationFile objects with filename, content, timestamp', () => {
    const dir = path.join(tmpDir, 'migrations')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, '20260321143000_initial.sql'), 'CREATE TABLE users (id INT);')

    const result = readMigrationDir(dir)
    expect(result).toHaveLength(1)

    const file: MigrationFile = result[0]
    expect(file.filename).toBe('20260321143000_initial.sql')
    expect(file.content).toBe('CREATE TABLE users (id INT);')
    expect(file.timestamp).toBe('20260321143000')
  })
})

describe('migrationFilename', () => {
  it('produces YYYYMMDDHHMMSS_name.sql format', () => {
    const filename = migrationFilename('add_users')
    // Should match pattern: 14 digits, underscore, name, .sql
    expect(filename).toMatch(/^\d{14}_add_users\.sql$/)
  })

  it('sanitizes name: lowercase and replace non-alphanum with underscore', () => {
    const filename = migrationFilename('Add User Table!')
    // "Add User Table!" -> "add_user_table_" -> stripped trailing _ -> "add_user_table"
    expect(filename).toMatch(/^\d{14}_add_user_table\.sql$/)
  })

  it('strips leading and trailing underscores from sanitized name', () => {
    const filename = migrationFilename('--hello--')
    expect(filename).toMatch(/^\d{14}_hello\.sql$/)
  })

  it('defaults to "migration" when name is empty', () => {
    const filename = migrationFilename('')
    expect(filename).toMatch(/^\d{14}_migration\.sql$/)
  })

  it('defaults to "migration" when name becomes empty after sanitization', () => {
    const filename = migrationFilename('---')
    expect(filename).toMatch(/^\d{14}_migration\.sql$/)
  })
})

describe('writeMigrationFile', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-migrations-write-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates directory if it does not exist', () => {
    const dir = path.join(tmpDir, 'new', 'nested', 'migrations')
    writeMigrationFile(dir, '20260321143000_test.sql', ['CREATE TABLE a (id INT)'])

    expect(fs.existsSync(dir)).toBe(true)
  })

  it('writes statements joined by semicolons with trailing semicolon', () => {
    const dir = path.join(tmpDir, 'migrations')
    writeMigrationFile(dir, '20260321143000_test.sql', ['CREATE TABLE a (id INT)', 'CREATE TABLE b (id INT)'])

    const content = fs.readFileSync(path.join(dir, '20260321143000_test.sql'), 'utf-8')
    expect(content).toBe('CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);\n')
  })

  it('returns the absolute path of the written file', () => {
    const dir = path.join(tmpDir, 'migrations')
    const result = writeMigrationFile(dir, '20260321143000_test.sql', ['SELECT 1'])

    expect(path.isAbsolute(result)).toBe(true)
    expect(result).toBe(path.join(dir, '20260321143000_test.sql'))
    expect(fs.existsSync(result)).toBe(true)
  })
})
