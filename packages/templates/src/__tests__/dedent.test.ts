import { describe, it } from 'node:test'
import { expect } from '@sqldoc/test-utils'
import { dedent } from '../tags/dedent.ts'

describe('dedent', () => {
  it('strips common leading whitespace', () => {
    const result = dedent`
      hello
      world
    `
    expect(result).toBe('hello\nworld')
  })

  it('preserves relative indentation', () => {
    const result = dedent`
      if (true) {
        return 1
      }
    `
    expect(result).toBe('if (true) {\n  return 1\n}')
  })

  it('handles string interpolation', () => {
    const name = 'World'
    const result = dedent`
      hello ${name}
      goodbye
    `
    expect(result).toBe('hello World\ngoodbye')
  })

  it('handles zero-indent lines', () => {
    const result = dedent`
hello
world
    `
    expect(result).toBe('hello\nworld')
  })

  it('removes empty first and last lines', () => {
    const result = dedent`
      content
    `
    expect(result).toBe('content')
  })
})
