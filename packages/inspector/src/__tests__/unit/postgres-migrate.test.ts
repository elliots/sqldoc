import assert from 'node:assert/strict'
import { describe, it } from '@sqldoc/test-utils'
import { hasClause } from '../../internal/plan.ts'
import { PostgresPlan, withCascade } from '../../postgres/migrate.ts'
import type { Change, Clause } from '../../schema/migrate.ts'

describe('PostgresPlan.dropTable', () => {
  const plan = new PostgresPlan()

  it('generates plain DROP TABLE with no clauses', () => {
    const table = { name: 'users', columns: [] }
    const stmts = plan.dropTable(table)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TABLE "users"')
  })

  it('generates DROP TABLE with schema', () => {
    const table = { name: 'users', schema: 'auth', columns: [] }
    const stmts = plan.dropTable(table)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TABLE "auth"."users"')
  })

  it('generates DROP TABLE IF EXISTS with if_exists clause', () => {
    const table = { name: 'users', columns: [] }
    const extra: Clause[] = [{ type: 'if_exists' }]
    const stmts = plan.dropTable(table, extra)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TABLE IF EXISTS "users"')
  })

  it('generates DROP TABLE CASCADE with cascade clause', () => {
    const table = { name: 'users', columns: [] }
    const extra: Clause[] = [{ type: 'cascade' }]
    const stmts = plan.dropTable(table, extra)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TABLE "users" CASCADE')
  })

  it('generates DROP TABLE IF EXISTS ... CASCADE with both clauses', () => {
    const table = { name: 'users', schema: 'public', columns: [] }
    const extra: Clause[] = [{ type: 'if_exists' }, { type: 'cascade' }]
    const stmts = plan.dropTable(table, extra)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TABLE IF EXISTS "public"."users" CASCADE')
  })
})

describe('withCascade', () => {
  it('annotates drop_table changes with if_exists and cascade', () => {
    const changes: Change[] = [
      { type: 'drop_table', T: { name: 'users', columns: [] } },
      { type: 'add_table', T: { name: 'posts', columns: [] } },
    ]
    const result = withCascade(changes)
    assert.equal(result.length, 2)
    const drop = result[0] as any
    assert.equal(drop.type, 'drop_table')
    assert.ok(hasClause(drop.extra, 'if_exists'))
    assert.ok(hasClause(drop.extra, 'cascade'))
    // add_table should be untouched
    const add = result[1] as any
    assert.equal(add.extra, undefined)
  })

  it('annotates drop_object changes with if_exists and cascade', () => {
    const changes: Change[] = [{ type: 'drop_object', O: { kind: 'enum', T: 'status' } }]
    const result = withCascade(changes)
    const drop = result[0] as any
    assert.ok(hasClause(drop.extra, 'if_exists'))
    assert.ok(hasClause(drop.extra, 'cascade'))
  })

  it('annotates drop_view changes with if_exists and cascade', () => {
    const changes: Change[] = [{ type: 'drop_view', V: { name: 'user_view' } } as Change]
    const result = withCascade(changes)
    const drop = result[0] as any
    assert.ok(hasClause(drop.extra, 'if_exists'))
    assert.ok(hasClause(drop.extra, 'cascade'))
  })

  it('annotates drop_func changes with if_exists and cascade', () => {
    const changes: Change[] = [{ type: 'drop_func', F: { name: 'my_func' } } as Change]
    const result = withCascade(changes)
    const drop = result[0] as any
    assert.ok(hasClause(drop.extra, 'if_exists'))
    assert.ok(hasClause(drop.extra, 'cascade'))
  })

  it('annotates drop_proc changes with if_exists and cascade', () => {
    const changes: Change[] = [{ type: 'drop_proc', P: { name: 'my_proc' } } as Change]
    const result = withCascade(changes)
    const drop = result[0] as any
    assert.ok(hasClause(drop.extra, 'if_exists'))
    assert.ok(hasClause(drop.extra, 'cascade'))
  })

  it('annotates drop_schema changes with if_exists and cascade', () => {
    const changes: Change[] = [{ type: 'drop_schema', S: { name: 'myschema' } } as Change]
    const result = withCascade(changes)
    const drop = result[0] as any
    assert.ok(hasClause(drop.extra, 'if_exists'))
    assert.ok(hasClause(drop.extra, 'cascade'))
  })

  it('annotates drop_trigger changes with if_exists and cascade', () => {
    const changes: Change[] = [{ type: 'drop_trigger', T: { name: 'my_trigger', table: 'users' } } as Change]
    const result = withCascade(changes)
    const drop = result[0] as any
    assert.ok(hasClause(drop.extra, 'if_exists'))
    assert.ok(hasClause(drop.extra, 'cascade'))
  })

  it('annotates drop_sequence changes with if_exists and cascade', () => {
    const changes: Change[] = [{ type: 'drop_sequence', S: { name: 'my_seq' } } as Change]
    const result = withCascade(changes)
    const drop = result[0] as any
    assert.ok(hasClause(drop.extra, 'if_exists'))
    assert.ok(hasClause(drop.extra, 'cascade'))
  })

  it('annotates drop_policy changes with if_exists and cascade', () => {
    const changes: Change[] = [{ type: 'drop_policy', P: { name: 'my_policy' } } as Change]
    const result = withCascade(changes)
    const drop = result[0] as any
    assert.ok(hasClause(drop.extra, 'if_exists'))
    assert.ok(hasClause(drop.extra, 'cascade'))
  })

  it('does not modify non-drop changes', () => {
    const changes: Change[] = [
      { type: 'add_table', T: { name: 'users', columns: [] } },
      { type: 'modify_table', T: { name: 'users', columns: [] }, changes: [] },
    ]
    const result = withCascade(changes)
    for (const c of result) {
      assert.equal((c as any).extra, undefined)
    }
  })

  it('preserves existing extra clauses', () => {
    const changes: Change[] = [
      { type: 'drop_table', T: { name: 'users', columns: [] }, extra: [{ type: 'if_not_exists' }] },
    ]
    const result = withCascade(changes)
    const drop = result[0] as any
    assert.equal(drop.extra.length, 3)
    assert.ok(hasClause(drop.extra, 'if_not_exists'))
    assert.ok(hasClause(drop.extra, 'if_exists'))
    assert.ok(hasClause(drop.extra, 'cascade'))
  })
})

describe('hasClause', () => {
  it('returns true when clause type exists', () => {
    const extra: Clause[] = [{ type: 'if_exists' }, { type: 'cascade' }]
    assert.equal(hasClause(extra, 'if_exists'), true)
    assert.equal(hasClause(extra, 'cascade'), true)
  })

  it('returns false when clause type does not exist', () => {
    const extra: Clause[] = [{ type: 'if_exists' }]
    assert.equal(hasClause(extra, 'cascade'), false)
  })

  it('returns false for undefined extra', () => {
    assert.equal(hasClause(undefined, 'cascade'), false)
  })

  it('returns false for empty extra', () => {
    assert.equal(hasClause([], 'cascade'), false)
  })
})

describe('PostgresPlan.dropObject', () => {
  const plan = new PostgresPlan()

  it('generates DROP TYPE for range_type', () => {
    const obj = { kind: 'range_type', T: 'float_range' }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TYPE "float_range"')
  })

  it('generates DROP TYPE for range_type with schema', () => {
    const obj = { kind: 'range_type', T: 'float_range', schema: 'custom' }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TYPE "custom"."float_range"')
  })

  it('generates DROP AGGREGATE for aggregate', () => {
    const obj = { kind: 'aggregate', name: 'array_agg_custom', args: ['integer'] }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP AGGREGATE "array_agg_custom"(integer)')
  })

  it('generates DROP AGGREGATE with schema', () => {
    const obj = { kind: 'aggregate', name: 'my_agg', args: ['text', 'integer'], schema: 'analytics' }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP AGGREGATE "analytics"."my_agg"(text, integer)')
  })

  it('generates DROP AGGREGATE with no args', () => {
    const obj = { kind: 'aggregate', name: 'my_agg', args: [] }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP AGGREGATE "my_agg"()')
  })

  it('generates DROP TYPE for composite', () => {
    const obj = { kind: 'composite', T: 'address_type' }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TYPE "address_type"')
  })

  it('generates DROP DOMAIN for domain', () => {
    const obj = { kind: 'domain', T: 'email_domain' }
    const stmts = plan.dropObject(obj)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP DOMAIN "email_domain"')
  })

  it('generates DROP TYPE IF EXISTS ... CASCADE for enum with extra clauses', () => {
    const obj = { kind: 'enum', T: 'status', values: ['active', 'inactive'] }
    const extra: Clause[] = [{ type: 'if_exists' }, { type: 'cascade' }]
    const stmts = plan.dropObject(obj, extra)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TYPE IF EXISTS "status" CASCADE')
  })

  it('generates DROP TYPE IF EXISTS ... CASCADE for range_type with extra clauses', () => {
    const obj = { kind: 'range_type', T: 'float_range' }
    const extra: Clause[] = [{ type: 'if_exists' }, { type: 'cascade' }]
    const stmts = plan.dropObject(obj, extra)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP TYPE IF EXISTS "float_range" CASCADE')
  })

  it('generates DROP AGGREGATE IF EXISTS ... CASCADE with extra clauses', () => {
    const obj = { kind: 'aggregate', name: 'my_agg', args: ['integer'] }
    const extra: Clause[] = [{ type: 'if_exists' }, { type: 'cascade' }]
    const stmts = plan.dropObject(obj, extra)
    assert.equal(stmts.length, 1)
    assert.equal(stmts[0], 'DROP AGGREGATE IF EXISTS "my_agg"(integer) CASCADE')
  })
})

describe('PostgresPlan.dropView', () => {
  const plan = new PostgresPlan()

  it('generates plain DROP VIEW', () => {
    const view = { name: 'user_view' }
    const stmts = plan.dropView(view as any)
    assert.equal(stmts[0], 'DROP VIEW "user_view"')
  })

  it('generates DROP VIEW IF EXISTS ... CASCADE with extra clauses', () => {
    const view = { name: 'user_view', schema: 'public' }
    const extra: Clause[] = [{ type: 'if_exists' }, { type: 'cascade' }]
    const stmts = plan.dropView(view as any, extra)
    assert.equal(stmts[0], 'DROP VIEW IF EXISTS "public"."user_view" CASCADE')
  })

  it('generates DROP MATERIALIZED VIEW IF EXISTS with extra clauses', () => {
    const view = { name: 'mat_view', materialized: true }
    const extra: Clause[] = [{ type: 'if_exists' }]
    const stmts = plan.dropView(view as any, extra)
    assert.equal(stmts[0], 'DROP MATERIALIZED VIEW IF EXISTS "mat_view"')
  })
})

describe('PostgresPlan.dropFunc', () => {
  const plan = new PostgresPlan()

  it('generates DROP FUNCTION IF EXISTS ... CASCADE with extra clauses', () => {
    const func = { name: 'my_func', schema: 'public' }
    const extra: Clause[] = [{ type: 'if_exists' }, { type: 'cascade' }]
    const stmts = plan.dropFunc(func as any, extra)
    assert.equal(stmts[0], 'DROP FUNCTION IF EXISTS "public"."my_func" CASCADE')
  })
})

describe('PostgresPlan.dropProc', () => {
  const plan = new PostgresPlan()

  it('generates DROP PROCEDURE IF EXISTS ... CASCADE with extra clauses', () => {
    const proc = { name: 'my_proc', schema: 'public' }
    const extra: Clause[] = [{ type: 'if_exists' }, { type: 'cascade' }]
    const stmts = plan.dropProc(proc as any, extra)
    assert.equal(stmts[0], 'DROP PROCEDURE IF EXISTS "my_proc" CASCADE')
  })
})

describe('PostgresPlan.dropSchema', () => {
  const plan = new PostgresPlan()

  it('generates DROP SCHEMA ... CASCADE without extra', () => {
    const schema = { name: 'myschema' }
    const stmts = plan.dropSchema(schema as any)
    assert.equal(stmts[0], 'DROP SCHEMA "myschema" CASCADE')
  })

  it('generates DROP SCHEMA IF EXISTS ... CASCADE with extra clauses', () => {
    const schema = { name: 'myschema' }
    const extra: Clause[] = [{ type: 'if_exists' }]
    const stmts = plan.dropSchema(schema as any, extra)
    assert.equal(stmts[0], 'DROP SCHEMA IF EXISTS "myschema" CASCADE')
  })
})

describe('PostgresPlan.dropTrigger', () => {
  const plan = new PostgresPlan()

  it('generates DROP TRIGGER IF EXISTS ... CASCADE with extra clauses', () => {
    const trigger = { name: 'my_trigger', table: 'users' }
    const extra: Clause[] = [{ type: 'if_exists' }, { type: 'cascade' }]
    const stmts = plan.dropTrigger(trigger as any, extra)
    assert.equal(stmts[0], 'DROP TRIGGER IF EXISTS "my_trigger" ON "users" CASCADE')
  })
})

describe('PostgresPlan.dropSequence', () => {
  const plan = new PostgresPlan()

  it('generates DROP SEQUENCE IF EXISTS ... CASCADE with extra clauses', () => {
    const seq = { name: 'my_seq' }
    const extra: Clause[] = [{ type: 'if_exists' }, { type: 'cascade' }]
    const stmts = plan.dropSequence(seq as any, extra)
    assert.equal(stmts[0], 'DROP SEQUENCE IF EXISTS "my_seq" CASCADE')
  })

  it('generates DROP SEQUENCE IF EXISTS with schema and CASCADE', () => {
    const seq = { name: 'my_seq', schema: 'public' }
    const extra: Clause[] = [{ type: 'if_exists' }, { type: 'cascade' }]
    const stmts = plan.dropSequence(seq as any, extra)
    assert.equal(stmts[0], 'DROP SEQUENCE IF EXISTS "public"."my_seq" CASCADE')
  })
})

describe('PostgresPlan default schema stripping', () => {
  const plan = new PostgresPlan()
  plan.defaultSchema = 'app'

  it('strips default schema from FK references in addTable', () => {
    const table = {
      name: 'orders',
      schema: 'app',
      columns: [{ name: 'id', type: { kind: 'integer' as const, type: { kind: 'integer' as const, T: 'integer' } } }],
      foreignKeys: [
        {
          symbol: 'orders_user_fkey',
          columns: ['user_id'],
          refSchema: 'app',
          refTable: 'users',
          refColumns: ['id'],
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
      ],
    }
    const stmts = plan.addTable(table as any)
    const createStmt = stmts[0]
    assert.ok(!createStmt.includes('"app"'), `should not contain default schema qualifier: ${createStmt}`)
    assert.ok(createStmt.includes('REFERENCES "users"'), `should reference unqualified table: ${createStmt}`)
  })

  it('keeps non-default schema in FK references', () => {
    const table = {
      name: 'orders',
      schema: 'app',
      columns: [{ name: 'id', type: { kind: 'integer' as const, type: { kind: 'integer' as const, T: 'integer' } } }],
      foreignKeys: [
        {
          symbol: 'orders_account_fkey',
          columns: ['account_id'],
          refSchema: 'billing',
          refTable: 'accounts',
          refColumns: ['id'],
        },
      ],
    }
    const stmts = plan.addTable(table as any)
    const createStmt = stmts[0]
    assert.ok(createStmt.includes('"billing"."accounts"'), `should keep non-default schema: ${createStmt}`)
  })

  it('strips default schema from table comment', () => {
    const table = {
      name: 'users',
      schema: 'app',
      columns: [{ name: 'id', type: { kind: 'integer' as const, type: { kind: 'integer' as const, T: 'integer' } } }],
      attrs: [{ kind: 'comment', text: 'User accounts' }],
    }
    const stmts = plan.addTable(table as any)
    const commentStmt = stmts.find((s) => s.startsWith('COMMENT ON TABLE'))
    assert.ok(commentStmt, 'should have a COMMENT statement')
    assert.ok(!commentStmt!.includes('"app"'), `should not contain default schema: ${commentStmt}`)
    assert.ok(commentStmt!.includes('"users"'), `should reference unqualified table: ${commentStmt}`)
  })

  it('strips default schema from CREATE TABLE name', () => {
    const table = {
      name: 'users',
      schema: 'app',
      columns: [{ name: 'id', type: { kind: 'integer' as const, type: { kind: 'integer' as const, T: 'integer' } } }],
    }
    const stmts = plan.addTable(table as any)
    assert.ok(stmts[0].startsWith('CREATE TABLE "users"'), `should strip schema: ${stmts[0]}`)
  })

  it('strips default schema from trigger DDL', () => {
    const trigger = {
      name: 'trg_audit',
      schema: 'app',
      table: 'jobs',
      timing: 'AFTER',
      events: ['UPDATE'],
      forEach: 'ROW',
      actionCondition: '(old.status IS DISTINCT FROM new.status)',
      funcName: 'audit_fn',
      funcSchema: 'app',
    }
    const stmts = plan.addTrigger!(trigger as any)
    assert.equal(stmts.length, 1)
    assert.ok(!stmts[0].includes('"app"'), `should not contain default schema qualifier: ${stmts[0]}`)
    assert.ok(stmts[0].includes('ON "jobs"'), `should have unqualified table: ${stmts[0]}`)
    assert.ok(stmts[0].includes('EXECUTE FUNCTION "audit_fn"'), `should have unqualified func: ${stmts[0]}`)
    assert.ok(stmts[0].includes('WHEN'), `should include WHEN clause: ${stmts[0]}`)
  })

  it('keeps non-default schema in trigger func reference', () => {
    const trigger = {
      name: 'trg_audit',
      schema: 'app',
      table: 'jobs',
      timing: 'AFTER',
      events: ['INSERT'],
      forEach: 'ROW',
      funcName: 'log_change',
      funcSchema: 'audit',
    }
    const stmts = plan.addTrigger!(trigger as any)
    assert.ok(stmts[0].includes('"audit"."log_change"'), `should keep non-default func schema: ${stmts[0]}`)
  })

  it('strips default schema from function DDL header', () => {
    const func = {
      name: 'my_func',
      schema: 'app',
      body: `CREATE OR REPLACE FUNCTION app.my_func()\n RETURNS void\n LANGUAGE sql\nAS $function$SELECT 1$function$`,
    }
    const stmts = plan.addFunc!(func as any)
    assert.ok(stmts[0].includes('FUNCTION my_func'), `should strip schema from func name: ${stmts[0]}`)
    assert.ok(!stmts[0].includes('app.my_func'), `should not contain app.my_func: ${stmts[0]}`)
  })

  it('strips default schema from composite type CREATE', () => {
    const stmts = plan.addObject!({
      kind: 'composite',
      T: 'health_report',
      schema: 'app',
      fields: [
        { name: 'id', type: { T: 'uuid' } },
        { name: 'score', type: { T: 'numeric' } },
      ],
    })
    assert.ok(stmts[0].startsWith('CREATE TYPE "health_report"'), `should strip schema: ${stmts[0]}`)
    assert.ok(!stmts[0].includes('"app"'), `should not contain default schema: ${stmts[0]}`)
  })

  it('keeps non-default schema on composite type CREATE', () => {
    const stmts = plan.addObject!({
      kind: 'composite',
      T: 'health_report',
      schema: 'reporting',
      fields: [{ name: 'id', type: { T: 'uuid' } }],
    })
    assert.ok(
      stmts[0].startsWith('CREATE TYPE "reporting"."health_report"'),
      `should keep non-default schema: ${stmts[0]}`,
    )
  })

  it('strips default schema from composite type DROP', () => {
    const stmts = plan.dropObject!({ kind: 'composite', T: 'health_report', schema: 'app' })
    assert.equal(stmts[0], 'DROP TYPE "health_report"')
  })

  it('strips default schema from domain type DDL', () => {
    const stmts = plan.addObject!({
      kind: 'domain',
      T: 'email',
      schema: 'app',
      type: { kind: 'text', T: 'text' },
      null: true,
    })
    assert.ok(stmts[0].startsWith('CREATE DOMAIN "email"'), `should strip schema: ${stmts[0]}`)
  })

  it('strips default schema from enum value ALTER', () => {
    const stmts = plan.addEnumValues('status', ['a', 'b'], ['a', 'b', 'c'], 'app')
    assert.ok(stmts[0].startsWith('ALTER TYPE "status"'), `should strip schema: ${stmts[0]}`)
  })

  it('preserves precision and scale in composite type fields', () => {
    const stmts = plan.addObject!({
      kind: 'composite',
      T: 'metrics',
      schema: 'app',
      fields: [
        { name: 'amount', type: { kind: 'decimal', T: 'numeric', precision: 10, scale: 4 } },
        { name: 'count', type: { kind: 'decimal', T: 'numeric', precision: 8 } },
      ],
    })
    assert.ok(stmts[0].includes('"amount" numeric(10,4)'), `should preserve precision/scale: ${stmts[0]}`)
    assert.ok(stmts[0].includes('"count" numeric(8)'), `should preserve precision: ${stmts[0]}`)
  })
})
