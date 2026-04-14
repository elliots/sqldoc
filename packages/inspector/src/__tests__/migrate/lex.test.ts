import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Scanner, scanStmts, stmts } from '../../migrate/lex.ts'

describe('Scanner', () => {
  it('splits simple semicolon-delimited statements', () => {
    const result = stmts('SELECT 1; SELECT 2;')
    assert.deepEqual(result, ['SELECT 1;', 'SELECT 2;'])
  })

  it('handles empty input', () => {
    const result = stmts('')
    assert.deepEqual(result, [])
  })

  it('handles whitespace-only input', () => {
    const result = stmts('   \n\t  ')
    assert.deepEqual(result, [])
  })

  it('handles trailing semicolons and whitespace', () => {
    const result = stmts('SELECT 1;\n\n')
    assert.deepEqual(result, ['SELECT 1;'])
  })

  it('handles multi-line statements', () => {
    const result = stmts('SELECT\n  1\n  FROM\n  dual;')
    assert.deepEqual(result, ['SELECT\n  1\n  FROM\n  dual;'])
  })

  it('handles single-quoted string escaping', () => {
    const result = stmts("SELECT 'it''s'; SELECT 'hello';")
    assert.equal(result.length, 2)
    assert.equal(result[0], "SELECT 'it''s';")
    assert.equal(result[1], "SELECT 'hello';")
  })

  it('handles double-quoted identifiers', () => {
    const result = stmts('SELECT "my;col" FROM t; SELECT 1;')
    assert.equal(result.length, 2)
  })

  it('handles backtick-quoted identifiers', () => {
    const result = stmts('SELECT `my;col` FROM t; SELECT 1;')
    assert.equal(result.length, 2)
  })

  it('handles dollar-quoted strings (PostgreSQL)', () => {
    const input = 'CREATE FUNCTION f() RETURNS void AS $$ BEGIN END $$;'
    const result = stmts(input)
    assert.equal(result.length, 1)
    assert.equal(result[0], input)
  })

  it('handles tagged dollar-quotes', () => {
    const input = 'CREATE FUNCTION f() RETURNS void AS $body$ BEGIN; END; $body$;'
    const result = stmts(input)
    assert.equal(result.length, 1)
  })

  it('handles BEGIN ATOMIC blocks', () => {
    const input = `CREATE FUNCTION add1(x int) RETURNS int
BEGIN ATOMIC
  RETURN x + 1;
END;`
    const result = stmts(input)
    assert.equal(result.length, 1)
  })

  it('handles block comments', () => {
    const result = stmts('/* comment */ SELECT 1; SELECT 2;')
    assert.equal(result.length, 2)
  })

  it('handles line comments (--)', () => {
    const result = stmts('-- comment\nSELECT 1; SELECT 2;')
    assert.equal(result.length, 2)
  })

  it('handles hash comments with option enabled', () => {
    const scanner = new Scanner({ hashComments: true, matchBeginAtomic: true, matchDollarQuote: true })
    const result = scanner.scan('# comment\nSELECT 1; SELECT 2;')
    assert.equal(result.length, 2)
  })

  it('handles MySQL DELIMITER command', () => {
    const input = `DELIMITER //
CREATE TRIGGER t BEFORE INSERT ON foo FOR EACH ROW BEGIN
  SET NEW.x = 1;
END//
DELIMITER ;
SELECT 1;`
    const scanner = new Scanner({
      matchBegin: true,
      matchBeginAtomic: true,
      matchDollarQuote: true,
      hashComments: true,
    })
    const result = scanner.scan(input)
    // Should have the trigger and the SELECT
    assert.ok(result.length >= 2, `expected at least 2 statements, got ${result.length}`)
  })

  it('handles consecutive semicolons', () => {
    // The Go scanner emits ";" as a valid statement (semicolons are part of the text).
    const result = stmts('SELECT 1;; SELECT 2;')
    assert.deepEqual(result, ['SELECT 1;', ';', 'SELECT 2;'])
  })

  it('handles statement without trailing semicolon', () => {
    const result = stmts('SELECT 1')
    assert.deepEqual(result, ['SELECT 1'])
  })

  it('tracks statement positions', () => {
    const result = scanStmts('SELECT 1; SELECT 2;')
    assert.equal(result[0].pos, 0)
    assert.ok(result[1].pos > 0)
  })

  it('collects comments associated with statements', () => {
    const scanner = new Scanner({
      matchBeginAtomic: true,
      matchDollarQuote: true,
      hashComments: true,
    })
    const result = scanner.scan('-- test\ncmd1;')
    assert.equal(result.length, 1)
    assert.equal(result[0].text, 'cmd1;')
    assert.deepEqual(result[0].comments, ['-- test\n'])
  })

  it('collects multiple comment lines', () => {
    const scanner = new Scanner({
      matchBeginAtomic: true,
      matchDollarQuote: true,
    })
    const result = scanner.scan('-- hello\n-- world\ncmd2;')
    assert.equal(result.length, 1)
    assert.equal(result[0].text, 'cmd2;')
    assert.deepEqual(result[0].comments, ['-- hello\n', '-- world\n'])
  })

  it('separates comment groups on double newlines', () => {
    const scanner = new Scanner({
      matchBeginAtomic: true,
      matchDollarQuote: true,
      hashComments: true,
    })
    const result = scanner.scan('-- skip\n\ncmd0;')
    assert.equal(result.length, 1)
    assert.equal(result[0].text, 'cmd0;')
    assert.deepEqual(result[0].comments, [])
  })

  it('handles block comment collection', () => {
    const scanner = new Scanner({
      matchBeginAtomic: true,
      matchDollarQuote: true,
    })
    const result = scanner.scan('/* comment1 *//* comment2 */cmd4;')
    assert.equal(result.length, 1)
    assert.equal(result[0].text, 'cmd4;')
    assert.deepEqual(result[0].comments, ['/* comment1 */', '/* comment2 */'])
  })
})

describe('Scanner errors', () => {
  it('reports unclosed single quote', () => {
    assert.throws(() => stmts("'unclosed"), { message: /unclosed quote/ })
  })

  it('reports unclosed double quote', () => {
    assert.throws(() => stmts('"unclosed'), { message: /unclosed quote/ })
  })

  it('reports unclosed parentheses', () => {
    assert.throws(() => stmts('(unclosed'), { message: /unclosed '\('/ })
  })

  it('reports unexpected closing parentheses', () => {
    assert.throws(() => stmts('1234)6789'), { message: /unexpected '\)'/ })
  })
})

describe('Scanner with directive delimiter', () => {
  it('handles sqldoc:delimiter directive at start of file', () => {
    const input = '-- sqldoc:delimiter \\n\nSELECT 1\nSELECT 2'
    assert.deepEqual(stmts(input), ['SELECT 1', 'SELECT 2'])
    const result = scanStmts(input)
    assert.equal(result[0].pos, '-- sqldoc:delimiter \\n\n'.length)
  })

  it('trims CRLF and trailing whitespace from the delimiter directive', () => {
    const input = '-- sqldoc:delimiter $$  \r\nSELECT 1$$SELECT 2$$'
    assert.deepEqual(stmts(input), ['SELECT 1', 'SELECT 2'])
    const result = scanStmts(input)
    assert.equal(result[0].pos, '-- sqldoc:delimiter $$  \r\n'.length)
  })
})
