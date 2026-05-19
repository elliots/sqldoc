import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import { MysqlPlan } from '../../mysql/migrate.ts'

describe('MysqlPlan.modifyTable modify_check', () => {
  const plan = new MysqlPlan()

  it('splits modify_check into drop + add as separate ALTER statements', () => {
    const table = { name: 'orders', columns: [{ name: 'amount', type: { type: { kind: 'integer', T: 'int' } } }] }
    const fromCheck = { name: 'chk_amount', expr: 'amount > 0' }
    const toCheck = { name: 'chk_amount', expr: 'amount >= 0' }
    const changes = [{ type: 'modify_check' as const, from: fromCheck, to: toCheck }]

    const stmts = plan.modifyTable(table as any, table as any, changes as any)

    // Should produce two ALTER TABLE statements: first drop, then add
    assert.equal(stmts.length, 2)
    assert.ok(stmts[0].includes('DROP CONSTRAINT'), `expected DROP CONSTRAINT, got: ${stmts[0]}`)
    assert.ok(stmts[0].includes('chk_amount'), `expected constraint name, got: ${stmts[0]}`)
    assert.ok(stmts[1].includes('ADD'), `expected ADD, got: ${stmts[1]}`)
    assert.ok(stmts[1].includes('CHECK'), `expected CHECK, got: ${stmts[1]}`)
    assert.ok(stmts[1].includes('amount >= 0'), `expected new expr, got: ${stmts[1]}`)
  })

  it('does not produce modify_check directly in output', () => {
    const table = { name: 'items', columns: [{ name: 'qty', type: { type: { kind: 'integer', T: 'int' } } }] }
    const changes = [
      {
        type: 'modify_check' as const,
        from: { name: 'chk_qty', expr: 'qty > 0' },
        to: { name: 'chk_qty', expr: 'qty > 1' },
      },
    ]

    const stmts = plan.modifyTable(table as any, table as any, changes as any)

    // Each statement should be valid SQL, not containing "MODIFY CHECK"
    for (const stmt of stmts) {
      assert.ok(!stmt.includes('MODIFY CHECK'), `unexpected MODIFY CHECK in: ${stmt}`)
    }
  })
})
