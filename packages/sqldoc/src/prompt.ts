import * as readline from 'node:readline'
import pc from 'picocolors'

/**
 * Low-level: ask a question, return the raw answer.
 */
function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve))
}

/**
 * Create a readline interface on stdin/stdout.
 */
export function createRL(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout })
}

/**
 * Prompt the user to select one option from a list.
 * Shows numbered options; user types a number or presses Enter for default.
 */
export async function promptSelect<T extends string>(
  rl: readline.Interface,
  message: string,
  options: Array<{ value: T; label: string }>,
  defaultValue: T,
): Promise<T> {
  console.log('')
  console.log(pc.bold(message))
  for (let i = 0; i < options.length; i++) {
    const isDefault = options[i].value === defaultValue
    const marker = isDefault ? pc.cyan('*') : ' '
    console.log(`  ${marker} ${i + 1}) ${options[i].label}`)
  }

  const defaultIdx = options.findIndex((o) => o.value === defaultValue)
  const answer = await ask(rl, `${pc.dim(`[${defaultIdx + 1}]`)} > `)

  if (answer.trim() === '') return defaultValue
  const idx = Number.parseInt(answer.trim(), 10) - 1
  if (idx >= 0 && idx < options.length) return options[idx].value
  return defaultValue
}

/**
 * Prompt the user to select multiple options from a list.
 * Shows numbered options; user types comma-separated numbers.
 * Enter with no input selects the defaults.
 */
export async function promptCheckbox<T extends string>(
  rl: readline.Interface,
  message: string,
  options: Array<{ value: T; label: string; checked?: boolean }>,
): Promise<T[]> {
  console.log('')
  console.log(pc.bold(message))
  console.log(pc.dim('  (enter comma-separated numbers, or press Enter for defaults)'))
  for (let i = 0; i < options.length; i++) {
    const marker = options[i].checked ? pc.green('[x]') : pc.dim('[ ]')
    console.log(`  ${marker} ${i + 1}) ${options[i].label}`)
  }

  const defaults = options.filter((o) => o.checked).map((o) => o.value)
  const answer = await ask(
    rl,
    `${pc.dim(
      `[${options
        .map((o, i) => (o.checked ? i + 1 : ''))
        .filter(Boolean)
        .join(',')}]`,
    )} > `,
  )

  if (answer.trim() === '') return defaults

  const indices = answer.split(',').map((s) => Number.parseInt(s.trim(), 10) - 1)
  const selected: T[] = []
  for (const idx of indices) {
    if (idx >= 0 && idx < options.length) {
      selected.push(options[idx].value)
    }
  }
  return selected.length > 0 ? selected : defaults
}

/**
 * Simple yes/no confirmation prompt. Enter = yes.
 */
export async function promptConfirm(rl: readline.Interface, message: string): Promise<boolean> {
  const answer = await ask(rl, `${message} ${pc.dim('(Y/n)')} `)
  return answer.trim() === '' || answer.trim().toLowerCase() === 'y'
}
