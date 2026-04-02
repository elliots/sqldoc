/**
 * Generates site/cli/index.md from sqldoc --help-json output.
 * Run as: bun site/data/generate-cli-reference.ts
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

interface CliOption { flags: string; description: string }
interface CliArgument { name: string; description: string; required: boolean }
interface CliCommand {
  name: string
  description: string
  arguments?: CliArgument[]
  options?: CliOption[]
  subcommands?: CliCommand[]
}

const cliEntry = path.resolve(import.meta.dirname!, '../../packages/cli/src/index.ts')
const json = execSync(`bun ${cliEntry} --help-json`, { encoding: 'utf-8' }).trim()
const commands: CliCommand[] = JSON.parse(json)

function renderCommand(cmd: CliCommand, prefix: string, level: '##' | '###'): string {
  const lines: string[] = []
  const fullName = `${prefix} ${cmd.name}`.trim()
  const args = (cmd.arguments ?? []).map(a => a.required ? `&lt;${a.name}&gt;` : `[${a.name}]`).join(' ')

  lines.push(`${level} \`sqldoc ${fullName}\``)
  lines.push('')
  lines.push(cmd.description.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
  lines.push('')
  lines.push('```bash')
  lines.push(`sqldoc ${fullName}${args ? ' ' + args : ''} [options]`)
  lines.push('```')
  lines.push('')

  if (cmd.arguments?.length) {
    lines.push('**Arguments:**')
    lines.push('')
    lines.push('| Name | Required | Description |')
    lines.push('|------|----------|-------------|')
    for (const arg of cmd.arguments) {
      const argDesc = arg.description.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      lines.push(`| \`${arg.name}\` | ${arg.required ? 'Yes' : 'No'} | ${argDesc} |`)
    }
    lines.push('')
  }

  if (cmd.options?.length) {
    lines.push('**Options:**')
    lines.push('')
    lines.push('| Flag | Description |')
    lines.push('|------|-------------|')
    for (const opt of cmd.options) {
      const flags = opt.flags.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const desc = opt.description.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      lines.push(`| <code v-pre>${flags}</code> | ${desc} |`)
    }
    lines.push('')
  }

  if (cmd.subcommands?.length) {
    for (const sub of cmd.subcommands) {
      lines.push(renderCommand(sub, fullName, '###'))
    }
  }

  return lines.join('\n')
}

const sections = commands.map(cmd => renderCommand(cmd, '', '##')).join('\n---\n\n')

const content = `---
outline: deep
---

# CLI Reference

The sqldoc CLI provides commands for code generation, validation, linting, schema management, and migrations.

## Installation

::: code-group

\`\`\`bash [Homebrew]
brew install elliots/sqldoc/sqldoc
\`\`\`

or download the latest release from [GitHub Releases](https://github.com/elliots/sqldoc/releases) for your platform.
:::

${sections}
`

const outPath = path.resolve(import.meta.dirname!, '../cli/index.md')
fs.writeFileSync(outPath, content, 'utf-8')
console.log('Generated cli/index.md')
