import { describe, expect, it } from '@sqldoc/test-utils'
import { detectDestructiveChanges } from '../utils/destructive.ts'

describe('detectDestructiveChanges', () => {
  it('returns empty array for non-destructive statements', () => {
    const statements = [
      'CREATE TABLE users (id INT)',
      'ALTER TABLE users ADD COLUMN email TEXT',
      'CREATE INDEX idx_users_email ON users (email)',
    ]
    const result = detectDestructiveChanges(statements)
    expect(result).toEqual([])
  })

  it('detects DROP TABLE', () => {
    const statements = ['DROP TABLE audit_log']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('DROP TABLE audit_log')
  })

  it('detects DROP TABLE IF EXISTS', () => {
    const statements = ['DROP TABLE IF EXISTS audit_log']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('DROP TABLE audit_log')
  })

  it('detects DROP TABLE with quoted name', () => {
    const statements = ['DROP TABLE "audit_log"']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('DROP TABLE audit_log')
  })

  it('detects ALTER TABLE DROP COLUMN', () => {
    const statements = ['ALTER TABLE users DROP COLUMN legacy_id']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('ALTER TABLE users DROP COLUMN legacy_id')
  })

  it('detects ALTER TABLE DROP COLUMN IF EXISTS', () => {
    const statements = ['ALTER TABLE users DROP COLUMN IF EXISTS legacy_id']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('ALTER TABLE users DROP COLUMN legacy_id')
  })

  it('detects ALTER TABLE ONLY ... DROP COLUMN', () => {
    const statements = ['ALTER TABLE ONLY users DROP COLUMN legacy_id']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('ALTER TABLE users DROP COLUMN legacy_id')
  })

  it('detects DROP INDEX', () => {
    const statements = ['DROP INDEX idx_users_email']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('DROP INDEX idx_users_email')
  })

  it('detects DROP INDEX CONCURRENTLY IF EXISTS', () => {
    const statements = ['DROP INDEX CONCURRENTLY IF EXISTS idx_users_email']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('DROP INDEX idx_users_email')
  })

  it('detects DROP VIEW', () => {
    const statements = ['DROP VIEW active_users']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('DROP VIEW active_users')
  })

  it('detects DROP FUNCTION', () => {
    const statements = ['DROP FUNCTION calculate_total']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('DROP FUNCTION calculate_total')
  })

  it('detects TRUNCATE', () => {
    const statements = ['TRUNCATE TABLE sessions']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('TRUNCATE sessions')
  })

  it('detects TRUNCATE without TABLE keyword', () => {
    const statements = ['TRUNCATE sessions']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('TRUNCATE sessions')
  })

  it('detects multiple destructive changes', () => {
    const statements = [
      'CREATE TABLE new_users (id INT)',
      'DROP TABLE audit_log',
      'ALTER TABLE users DROP COLUMN legacy_id',
      'CREATE INDEX idx ON new_users (id)',
      'DROP INDEX idx_old',
    ]
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(3)
    expect(result[0].description).toBe('DROP TABLE audit_log')
    expect(result[1].description).toBe('ALTER TABLE users DROP COLUMN legacy_id')
    expect(result[2].description).toBe('DROP INDEX idx_old')
  })

  it('is case-insensitive', () => {
    const statements = ['drop table USERS', 'alter table Orders drop column old_col']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(2)
  })

  it('handles multiline statements (whitespace normalization)', () => {
    const statements = ['ALTER TABLE\n  users\n  DROP COLUMN\n  legacy_id']
    const result = detectDestructiveChanges(statements)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('ALTER TABLE users DROP COLUMN legacy_id')
  })

  it('preserves the original statement in the result', () => {
    const stmt = 'DROP TABLE "my_table"'
    const result = detectDestructiveChanges([stmt])
    expect(result[0].statement).toBe(stmt)
  })
})
