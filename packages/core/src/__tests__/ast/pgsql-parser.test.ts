import { before, describe, expect, it } from '@sqldoc/test-utils'
import { PostgresAstAdapter } from '../../ast/pgsql-parser.ts'
import type { SqlCommentOn, SqlStatement } from '../../ast/types.ts'

const TEST_SQL = `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT
);

CREATE VIEW active_users AS SELECT * FROM users;

CREATE INDEX idx_users_email ON users (email);

CREATE TYPE user_role AS ENUM ('admin', 'user', 'guest');

CREATE FUNCTION get_user(p_id BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN END; $$;

CREATE TRIGGER user_audit AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION audit_fn();

COMMENT ON TABLE users IS 'User table';
COMMENT ON COLUMN users.email IS 'Email address';`

describe('PostgresAstAdapter', () => {
  let adapter: PostgresAstAdapter
  let stmts: SqlStatement[]
  let comments: SqlCommentOn[]

  before(async () => {
    adapter = new PostgresAstAdapter()
    await adapter.init()
    stmts = adapter.parseStatements(TEST_SQL)
    comments = adapter.parseComments(TEST_SQL)
  })

  it('parses CREATE TABLE with name and columns', () => {
    const table = stmts.find((statement) => statement.kind === 'table')
    expect(table).not.toBe(undefined)
    expect(table!.name).toBe('users')
    expect(table!.columns).toHaveLength(3)
    expect(table!.columns[0]).toMatchObject({ name: 'id', type: 'bigserial' })
    expect(table!.columns[1]).toMatchObject({ name: 'email', type: 'text' })
  })

  it('parses core postgres object types', () => {
    expect(stmts.find((statement) => statement.kind === 'view')?.name).toBe('active_users')
    expect(stmts.find((statement) => statement.kind === 'index')?.name).toBe('idx_users_email')
    expect(stmts.find((statement) => statement.kind === 'type')?.name).toBe('user_role')
    expect(stmts.find((statement) => statement.kind === 'function')?.name).toBe('get_user')
    expect(stmts.find((statement) => statement.kind === 'trigger')?.name).toBe('user_audit')
  })

  it('preserves line ordering across parsed statements', () => {
    const lines = stmts.map((statement) => statement.line)
    const uniqueLines = new Set(lines)
    expect(uniqueLines.size).toBe(stmts.length)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i] > lines[i - 1]).toBe(true)
    }
  })

  it('parses COMMENT ON statements with normalized keys', () => {
    expect(comments).toEqual([
      { targetKey: 'TABLE "users"', text: 'User table', line: 17 },
      { targetKey: 'COLUMN "users"."email"', text: 'Email address', line: 18 },
    ])
  })
})
