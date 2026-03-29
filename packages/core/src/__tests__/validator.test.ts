import { describe, it } from 'node:test'
import { expect } from '@sqldoc/test-utils'
import { parse } from '../parser.ts'
import type { TagDef, TagNamespace } from '../types.ts'
import { detectTargetFallback, validate } from '../validator.ts'

// -- Test namespace fixtures --

const maskDef: TagDef = {
  description: 'Mask column data',
  targets: ['column'],
  args: { type: { type: 'string', required: true } },
}

const policyDef: TagDef = {
  description: 'RLS policy',
  targets: ['table'],
  args: { name: { type: 'string', required: true }, check: { type: 'boolean' } },
}

const selfDef: TagDef = {
  description: 'Mark as searchable',
  targets: ['table', 'column'],
}

const anonNamespace: TagNamespace = {
  name: 'anon',
  tags: { mask: maskDef },
}

const searchableNamespace: TagNamespace = {
  name: 'searchable',
  tags: { $self: selfDef, fulltext: { description: 'Full text search', targets: ['column'] } },
}

const _rlsNamespace: TagNamespace = {
  name: 'rls',
  tags: { policy: policyDef },
}

function makeNamespaces(...entries: TagNamespace[]): Map<string, TagNamespace> {
  const map = new Map<string, TagNamespace>()
  for (const ns of entries) map.set(ns.name, ns)
  return map
}

// -- Helper: parse and validate in one call --

function parseAndValidate(docText: string, namespaces: Map<string, TagNamespace>) {
  const { tags } = parse(docText)
  return validate(tags, namespaces, docText)
}

// -- validate() tests --

describe('validate', () => {
  it('reports unknown namespace for unregistered namespace', () => {
    const doc = `-- @bogus.tag\nCREATE TABLE t (id INT);`
    const diags = parseAndValidate(doc, makeNamespaces())
    expect(diags).toHaveLength(1)
    expect(diags[0].message).toContain("Unknown namespace '@bogus'")
    expect(diags[0].severity).toBe('error')
  })

  it('reports unknown tag for tag not in namespace definition', () => {
    const doc = `-- @anon.bogus\nCREATE TABLE t (id INT);`
    const diags = parseAndValidate(doc, makeNamespaces(anonNamespace))
    expect(diags).toHaveLength(1)
    expect(diags[0].message).toContain("Unknown tag 'bogus' in namespace 'anon'")
    expect(diags[0].severity).toBe('error')
  })

  it('reports error when standalone tag used without $self defined', () => {
    const doc = `-- @anon\nCREATE TABLE t (id INT);`
    const diags = parseAndValidate(doc, makeNamespaces(anonNamespace))
    expect(diags).toHaveLength(1)
    expect(diags[0].message).toContain('cannot be used as a standalone tag')
  })

  it('produces no diagnostic when standalone tag has $self defined', () => {
    const doc = `-- @searchable\nCREATE TABLE t (id INT);`
    const diags = parseAndValidate(doc, makeNamespaces(searchableNamespace))
    expect(diags).toHaveLength(0)
  })

  it('reports target mismatch when tag is used on wrong SQL target', () => {
    // mask targets=['column'] but placed above CREATE FUNCTION
    const doc = `-- @anon.mask(type: email)\nCREATE OR REPLACE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;`
    const diags = parseAndValidate(doc, makeNamespaces(anonNamespace))
    expect(diags.length >= 1).toBeTruthy()
    const targetDiag = diags.find((d) => d.message.includes('cannot be used on a function'))
    expect(targetDiag).not.toBe(undefined)
    expect(targetDiag!.severity).toBe('error')
  })

  it('produces no diagnostics for valid usage', () => {
    const doc = `-- @anon.mask(type: email)\n  email TEXT NOT NULL`
    const diags = parseAndValidate(doc, makeNamespaces(anonNamespace))
    expect(diags).toHaveLength(0)
  })

  it('reports missing required named argument', () => {
    // mask requires 'type' arg
    const doc = `-- @anon.mask\n  email TEXT NOT NULL`
    const diags = parseAndValidate(doc, makeNamespaces(anonNamespace))
    expect(diags.length >= 1).toBeTruthy()
    const argDiag = diags.find((d) => d.message.includes('Missing required argument'))
    expect(argDiag).not.toBe(undefined)
  })

  it('reports error when tag does not accept arguments but args provided', () => {
    // searchable.$self has no args defined
    const noArgsNs: TagNamespace = {
      name: 'noargs',
      tags: { simple: { description: 'No args tag' } },
    }
    const doc = `-- @noargs.simple(foo: bar)\nCREATE TABLE t (id INT);`
    const diags = parseAndValidate(doc, makeNamespaces(noArgsNs))
    expect(diags.length >= 1).toBeTruthy()
    const argDiag = diags.find((d) => d.message.includes('does not accept arguments'))
    expect(argDiag).not.toBe(undefined)
  })

  it('reports error when named args given but positional expected', () => {
    const posNs: TagNamespace = {
      name: 'pos',
      tags: { order: { description: 'Order', args: [{ type: 'string' }] } },
    }
    const doc = `-- @pos.order(dir: asc)\nCREATE TABLE t (id INT);`
    const diags = parseAndValidate(doc, makeNamespaces(posNs))
    expect(diags.length >= 1).toBeTruthy()
    const argDiag = diags.find((d) => d.message.includes('expects positional arguments, not named'))
    expect(argDiag).not.toBe(undefined)
  })

  it('reports too many positional arguments', () => {
    const posNs: TagNamespace = {
      name: 'pos',
      tags: { order: { description: 'Order', args: [{ type: 'string' }] } },
    }
    const doc = `-- @pos.order(asc, desc, extra)\nCREATE TABLE t (id INT);`
    const diags = parseAndValidate(doc, makeNamespaces(posNs))
    expect(diags.length >= 1).toBeTruthy()
    const argDiag = diags.find((d) => d.message.includes('Too many arguments'))
    expect(argDiag).not.toBe(undefined)
  })

  it('reports wrong arg type when tag expects number but gets string', () => {
    const numNs: TagNamespace = {
      name: 'num',
      tags: { limit: { description: 'Limit', args: { count: { type: 'number', required: true } } } },
    }
    const doc = `-- @num.limit(count: abc)\nCREATE TABLE t (id INT);`
    const diags = parseAndValidate(doc, makeNamespaces(numNs))
    expect(diags.length >= 1).toBeTruthy()
    const typeDiag = diags.find((d) => d.message.includes('expected number'))
    expect(typeDiag).not.toBe(undefined)
  })

  it('sets correct line numbers on diagnostics', () => {
    const doc = `CREATE TABLE t (\n  -- @bogus.tag\n  id INT\n);`
    const diags = parseAndValidate(doc, makeNamespaces())
    expect(diags).toHaveLength(1)
    expect(diags[0].line).toBe(1) // zero-indexed, second line
  })

  it('validates multiple tags in same block independently', () => {
    const doc = `-- @anon.mask(type: email)\n-- @anon.bogus\n  email TEXT NOT NULL`
    const diags = parseAndValidate(doc, makeNamespaces(anonNamespace))
    // mask is valid on column, but bogus is unknown
    expect(diags.length >= 1).toBeTruthy()
    const unknownDiag = diags.find((d) => d.message.includes("Unknown tag 'bogus'"))
    expect(unknownDiag).not.toBe(undefined)
  })
})

// -- detectTargetFallback() tests --

describe('detectTargetFallback', () => {
  it('detects CREATE TABLE', () => {
    expect(detectTargetFallback(['CREATE TABLE users ('])).toBe('table')
  })

  it('detects CREATE OR REPLACE FUNCTION', () => {
    expect(detectTargetFallback(['CREATE OR REPLACE FUNCTION foo()'])).toBe('function')
  })

  it('detects CREATE VIEW', () => {
    expect(detectTargetFallback(['CREATE VIEW v AS'])).toBe('view')
  })

  it('detects CREATE UNIQUE INDEX', () => {
    expect(detectTargetFallback(['CREATE UNIQUE INDEX idx ON t (c)'])).toBe('index')
  })

  it('detects CREATE TYPE', () => {
    expect(detectTargetFallback(['CREATE TYPE mood AS ENUM'])).toBe('type')
  })

  it('detects CREATE TRIGGER', () => {
    expect(detectTargetFallback(['CREATE TRIGGER t AFTER INSERT'])).toBe('trigger')
  })

  it('detects column from indented non-CREATE line', () => {
    expect(detectTargetFallback(['  email TEXT NOT NULL'])).toBe('column')
  })

  it('returns unknown for empty array', () => {
    expect(detectTargetFallback([])).toBe('unknown')
  })
})
