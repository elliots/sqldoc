import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { realmDiff } from '../../internal/diff.ts'
import { changeToSQL, type PlanDriver } from '../../internal/plan.ts'
import { PostgresDiff } from '../../postgres/diff.ts'
import type { Change } from '../../schema/migrate.ts'
import type { Func, Proc, Realm } from '../../schema/schema.ts'

describe('realmDiff regressions', () => {
  it('emits add_sequence when a new schema introduces sequences', () => {
    const from: Realm = { schemas: [] }
    const to: Realm = {
      schemas: [
        {
          name: 'public',
          sequences: [{ name: 'user_id_seq' }],
        },
      ],
      defaultSchema: 'public',
    }

    const changes = realmDiff(new PostgresDiff(), from, to)

    assert.ok(changes.some((change) => change.type === 'add_sequence' && change.S.name === 'user_id_seq'))
    assert.ok(
      !changes.some(
        (change) => change.type === 'add_object' && (change as { O?: { name?: string } }).O?.name === 'user_id_seq',
      ),
    )
  })
})

describe('changeToSQL regressions', () => {
  const driver: PlanDriver = {
    addTable() {
      return []
    },
    dropTable() {
      return []
    },
    modifyTable() {
      return []
    },
    addFunc(func: Func) {
      return [`CREATE FUNCTION ${func.name}`]
    },
    dropFunc(func: Func) {
      return [`DROP FUNCTION ${func.name}`]
    },
    addProc(proc: Proc) {
      return [`CREATE PROCEDURE ${proc.name}`]
    },
    dropProc(proc: Proc) {
      return [`DROP PROCEDURE ${proc.name}`]
    },
  }

  it('falls back to drop+add for modify_func when modifyFunc is not implemented', () => {
    const change: Change = {
      type: 'modify_func',
      from: { name: 'from_func' },
      to: { name: 'to_func' },
    }

    assert.deepEqual(changeToSQL(driver, change), ['DROP FUNCTION from_func', 'CREATE FUNCTION to_func'])
  })

  it('falls back to drop+add for modify_proc when modifyProc is not implemented', () => {
    const change: Change = {
      type: 'modify_proc',
      from: { name: 'from_proc' },
      to: { name: 'to_proc' },
    }

    assert.deepEqual(changeToSQL(driver, change), ['DROP PROCEDURE from_proc', 'CREATE PROCEDURE to_proc'])
  })
})
