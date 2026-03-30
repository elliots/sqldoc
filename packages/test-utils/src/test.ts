/**
 * Cross-runtime test primitives.
 *
 * bun's test runner wraps each file in an implicit test context, so
 * importing describe/it from node:test causes "describe() inside
 * another test()" errors. This module uses bun:test when running
 * under bun's test runner, falling back to node:test for Node.js.
 *
 * node:test uses before/after; bun:test uses beforeAll/afterAll.
 * We re-export under the node:test names for consistency.
 */

const isBun = typeof (globalThis as any).Bun !== 'undefined'

let _describe: typeof import('node:test').describe
let _it: typeof import('node:test').it
let _before: typeof import('node:test').before
let _after: typeof import('node:test').after
let _beforeEach: typeof import('node:test').beforeEach
let _afterEach: typeof import('node:test').afterEach

if (isBun) {
  // @ts-expect-error -- bun:test only exists in Bun runtime
  const bunTest = await import('bun:test')
  _describe = bunTest.describe
  _it = bunTest.it ?? bunTest.test
  _before = bunTest.beforeAll
  _after = bunTest.afterAll
  _beforeEach = bunTest.beforeEach
  _afterEach = bunTest.afterEach
} else {
  const nodeTest = await import('node:test')
  _describe = nodeTest.describe
  _it = nodeTest.it
  _before = nodeTest.before
  _after = nodeTest.after
  _beforeEach = nodeTest.beforeEach
  _afterEach = nodeTest.afterEach
}

export const describe = _describe
export const it = _it
export const before = _before
export const after = _after
export const beforeEach = _beforeEach
export const afterEach = _afterEach
