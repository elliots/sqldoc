import { beforeAll, describe, expect, it } from 'vitest'
import { SqlparserTsAdapter } from '../../ast/sqlparser-ts'
import type { SqlStatement } from '../../ast/types'

const TEST_SQL = `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT
);

CREATE VIEW active_users AS SELECT * FROM users WHERE active = true;

CREATE INDEX idx_users_email ON users (email);

CREATE TYPE user_role AS ENUM ('admin', 'user', 'guest');

CREATE FUNCTION get_user(p_id BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN END; $$;

CREATE TRIGGER user_audit AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION audit_fn();`

describe('SqlparserTsAdapter', () => {
  let adapter: SqlparserTsAdapter
  let stmts: SqlStatement[]

  beforeAll(async () => {
    adapter = new SqlparserTsAdapter('postgres')
    await adapter.init()
    stmts = adapter.parseStatements(TEST_SQL)
  })

  it('parses CREATE TABLE with kind, objectName, and columns', () => {
    const table = stmts.find((s) => s.kind === 'table')
    expect(table).toBeDefined()
    expect(table!.objectName).toBe('users')
    expect(table!.columns).toBeDefined()
    expect(table!.columns!.length).toBe(3)

    const [id, email, name] = table!.columns!
    expect(id.name).toBe('id')
    expect(id.dataType).toBe('bigserial')
    expect(email.name).toBe('email')
    expect(email.dataType).toBe('text')
    expect(name.name).toBe('name')
    expect(name.dataType).toBe('text')
  })

  it('parses CREATE VIEW with kind and objectName', () => {
    const view = stmts.find((s) => s.kind === 'view')
    expect(view).toBeDefined()
    expect(view!.objectName).toBe('active_users')
  })

  it('parses CREATE INDEX with kind and objectName', () => {
    const index = stmts.find((s) => s.kind === 'index')
    expect(index).toBeDefined()
    expect(index!.objectName).toBe('idx_users_email')
  })

  it('parses CREATE TYPE (ENUM) with kind and objectName', () => {
    const type = stmts.find((s) => s.kind === 'type')
    expect(type).toBeDefined()
    expect(type!.objectName).toBe('user_role')
  })

  it('parses CREATE FUNCTION with kind and objectName', () => {
    const fn = stmts.find((s) => s.kind === 'function')
    expect(fn).toBeDefined()
    expect(fn!.objectName).toBe('get_user')
  })

  it('parses CREATE TRIGGER with kind and objectName', () => {
    const trigger = stmts.find((s) => s.kind === 'trigger')
    expect(trigger).toBeDefined()
    expect(trigger!.objectName).toBe('user_audit')
  })

  it('returns multiple statements with correct line numbers', () => {
    expect(stmts.length).toBe(6)
    // Each statement should have a different line
    const lines = stmts.map((s) => s.line)
    const uniqueLines = new Set(lines)
    expect(uniqueLines.size).toBe(6)
    // Lines should be in ascending order
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]).toBeGreaterThan(lines[i - 1])
    }
  })

  it('handles RETURNS SETOF gracefully (no crash)', () => {
    const setofSql = `CREATE FUNCTION list_users() RETURNS SETOF users LANGUAGE plpgsql AS $$ BEGIN RETURN QUERY SELECT * FROM users; END; $$;`
    // Should not throw
    const result = adapter.parseStatements(setofSql)
    // May return empty array (parse failure filtered) or a result -- either is acceptable
    expect(Array.isArray(result)).toBe(true)
  })

  it('handles $$ function bodies correctly', () => {
    const dollarSql = `CREATE TABLE t1 (id INT);

CREATE FUNCTION foo() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t1 VALUES (1);
  INSERT INTO t1 VALUES (2);
END;
$$;

CREATE TABLE t2 (id INT);`

    const result = adapter.parseStatements(dollarSql)
    const tableStmts = result.filter((s) => s.kind === 'table')
    expect(tableStmts.length).toBe(2)
    expect(tableStmts[0].objectName).toBe('t1')
    expect(tableStmts[1].objectName).toBe('t2')
    // t2 should be on a later line than t1
    expect(tableStmts[1].line).toBeGreaterThan(tableStmts[0].line)
  })
})
