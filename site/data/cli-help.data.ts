/**
 * VitePress data loader — runs `sqldoc --help-json` at build time
 * to generate CLI reference content from the actual CLI definition.
 */

import { execSync } from 'node:child_process'
import path from 'node:path'

export interface CliOption {
  flags: string
  description: string
}

export interface CliArgument {
  name: string
  description: string
  required: boolean
}

export interface CliCommand {
  name: string
  description: string
  arguments?: CliArgument[]
  options?: CliOption[]
  subcommands?: CliCommand[]
}

declare const data: CliCommand[]
export { data }

export default {
  load(): CliCommand[] {
    const cliEntry = path.resolve(import.meta.dirname!, '../../packages/cli/src/index.ts')
    const json = execSync(`bun ${cliEntry} --help-json`, {
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'production' },
    }).trim()
    return JSON.parse(json)
  },
}
