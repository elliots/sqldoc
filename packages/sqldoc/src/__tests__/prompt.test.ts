import * as readline from 'node:readline'
import { Readable, Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, mockMethod } from '@sqldoc/test-utils'
import { promptCheckbox, promptConfirm, promptSelect } from '../prompt.ts'

/**
 * Create a readline interface backed by a mock input stream.
 * Call `type(answer)` to feed the answer before the prompt reads it.
 */
function mockRL() {
  const input = new Readable({ read() {} })
  const output = new Writable({
    write(_chunk, _enc, cb) {
      cb()
    },
  })
  const rl = readline.createInterface({ input, output })

  return {
    rl,
    type(answer: string) {
      // Push the answer followed by newline into the readable stream
      input.push(`${answer}\n`)
    },
    close() {
      rl.close()
      input.destroy()
    },
  }
}

describe('promptSelect', () => {
  let consoleSpy: ReturnType<typeof mockMethod>

  beforeEach(() => {
    consoleSpy = mockMethod(console, 'log', () => {})
  })

  afterEach(() => {
    consoleSpy.restore()
  })

  it('returns default when user presses Enter', async () => {
    const { rl, type, close } = mockRL()
    const p = promptSelect(
      rl,
      'Pick:',
      [
        { value: 'a', label: 'Option A' },
        { value: 'b', label: 'Option B' },
      ],
      'b',
    )
    type('')
    const result = await p
    expect(result).toBe('b')
    close()
  })

  it('returns selected option by number', async () => {
    const { rl, type, close } = mockRL()
    const p = promptSelect(
      rl,
      'Pick:',
      [
        { value: 'a', label: 'Option A' },
        { value: 'b', label: 'Option B' },
      ],
      'a',
    )
    type('2')
    const result = await p
    expect(result).toBe('b')
    close()
  })

  it('returns default for invalid input', async () => {
    const { rl, type, close } = mockRL()
    const p = promptSelect(rl, 'Pick:', [{ value: 'a', label: 'Option A' }], 'a')
    type('99')
    const result = await p
    expect(result).toBe('a')
    close()
  })
})

describe('promptCheckbox', () => {
  let consoleSpy: ReturnType<typeof mockMethod>

  beforeEach(() => {
    consoleSpy = mockMethod(console, 'log', () => {})
  })

  afterEach(() => {
    consoleSpy.restore()
  })

  it('returns defaults when user presses Enter', async () => {
    const { rl, type, close } = mockRL()
    const p = promptCheckbox(rl, 'Pick:', [
      { value: 'a', label: 'A', checked: true },
      { value: 'b', label: 'B', checked: false },
      { value: 'c', label: 'C', checked: true },
    ])
    type('')
    const result = await p
    expect(result).toEqual(['a', 'c'])
    close()
  })

  it('returns selected items by number', async () => {
    const { rl, type, close } = mockRL()
    const p = promptCheckbox(rl, 'Pick:', [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ])
    type('1,3')
    const result = await p
    expect(result).toEqual(['a', 'c'])
    close()
  })

  it('handles spaces in comma-separated input', async () => {
    const { rl, type, close } = mockRL()
    const p = promptCheckbox(rl, 'Pick:', [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ])
    type('1, 2')
    const result = await p
    expect(result).toEqual(['a', 'b'])
    close()
  })
})

describe('promptConfirm', () => {
  it('returns true on empty input (Enter)', async () => {
    const { rl, type, close } = mockRL()
    const p = promptConfirm(rl, 'Continue?')
    type('')
    const result = await p
    expect(result).toBe(true)
    close()
  })

  it('returns true on "y"', async () => {
    const { rl, type, close } = mockRL()
    const p = promptConfirm(rl, 'Continue?')
    type('y')
    const result = await p
    expect(result).toBe(true)
    close()
  })

  it('returns false on "n"', async () => {
    const { rl, type, close } = mockRL()
    const p = promptConfirm(rl, 'Continue?')
    type('n')
    const result = await p
    expect(result).toBe(false)
    close()
  })
})
