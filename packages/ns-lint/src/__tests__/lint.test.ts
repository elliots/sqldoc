import { describe, it } from 'node:test'
import { expect } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('ns-lint plugin', () => {
  it('exports apiVersion === 1', () => {
    expect(plugin.apiVersion).toBe(1)
  })

  it('exports name === "lint"', () => {
    expect(plugin.name).toBe('lint')
  })

  it('has an ignore tag definition', () => {
    expect('ignore' in plugin.tags).toBeTruthy()
  })

  it('ignore tag targets tables, columns, views, and functions', () => {
    expect(plugin.tags.ignore.targets).toEqual(['table', 'column', 'view', 'function'])
  })

  it('ignore tag takes two positional string args', () => {
    const args = plugin.tags.ignore.args as Array<{ type: string }>
    expect(args).toHaveLength(2)
    expect(args[0].type).toBe('string')
    expect(args[1].type).toBe('string')
  })

  it('does not produce SQL output (no onTag)', () => {
    expect(plugin.onTag).toBe(undefined)
  })
})
