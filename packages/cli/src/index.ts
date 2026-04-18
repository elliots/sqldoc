import { createRequire } from 'node:module'

import { Command } from 'commander'
import pc from 'picocolors'

import { codegenCommand } from './commands/codegen.ts'
import { compileCommand } from './commands/compile.ts'
import { doctorCommand } from './commands/doctor.ts'
import { lintCommand } from './commands/lint.ts'
import { migrateCommand } from './commands/migrate.ts'
import { schemaDiffCommand, schemaInspectCommand } from './commands/schema.ts'
import { validateCommand } from './commands/validate.ts'
import { CliError } from './errors.ts'
import { runForAllConfigs } from './utils/workspace.ts'

/** Wrap a command action to support --all (run across all workspace configs) */
function withAll<T extends (...args: any[]) => Promise<void>>(action: T): T {
  return (async (...args: any[]) => {
    // Commander passes options as last arg (before the Command object)
    const opts = args.length >= 2 ? args.at(-2) : args[0]
    if (opts?.all) {
      const commandName = args.at(-1)?.name?.() ?? 'command'
      await runForAllConfigs(commandName, async (configPath) => {
        const newOpts = { ...opts, config: configPath, all: false }
        const newArgs = [...args]
        if (newArgs.length >= 2) newArgs[newArgs.length - 2] = newOpts
        else newArgs[0] = newOpts
        await action(...newArgs)
      })
    } else {
      await action(...args)
    }
  }) as T
}

const req = createRequire(import.meta.url)
const version: string = req('../package.json').version

export const program = new Command()

program.name('sqldoc').description('SQL documentation and code generation tool').version(version)

program
  .command('compile')
  .description('Compile SQL files and output merged SQL with generated statements')
  .argument('[path]', 'Path to SQL files or directory (defaults to config schema)')
  .option('-c, --config <path>', 'Path to sqldoc.config.ts')
  .option('-o, --output <path>', 'Write to file instead of stdout')
  .option('--include-external', 'Include @external files in compiled output')
  .option('--project <name>', 'Select a named project from multi-project config')
  .option('--all', 'Run across all config files in the workspace')
  .action(withAll(compileCommand))

program
  .command('codegen')
  .description('Run code generation plugins (templates, docs, etc.)')
  .argument('[path]', 'Path to SQL files or directory (defaults to config schema)')
  .option('-c, --config <path>', 'Path to sqldoc.config.ts')
  .option('-p, --plugins <names>', 'Comma-separated project-level plugin names to run (default: all)')
  .option(
    '-t, --template <names>',
    'Run template(s) by slug (comma-separated), ignoring config (output to stdout or -o dir)',
  )
  .option('-o, --output <path>', 'Output file path (used with --template)')
  .option('--project <name>', 'Select a named project from multi-project config')
  .option('--all', 'Run across all config files in the workspace')
  .action(withAll(codegenCommand))

program
  .command('validate')
  .description('Validate tags in SQL files')
  .argument('[path]', 'Path to SQL files or directory (defaults to config schema)')
  .option('-c, --config <path>', 'Path to sqldoc.config.ts')
  .option('--project <name>', 'Select a named project from multi-project config')
  .option('--all', 'Run across all config files in the workspace')
  .action(withAll(validateCommand))

program
  .command('lint')
  .description('Run lint rules from namespace plugins against SQL files')
  .argument('[path]', 'Path to SQL files or directory (defaults to config schema)')
  .option('-c, --config <path>', 'Path to sqldoc.config.ts')
  .option('-v, --verbose', 'Show ignored rules')
  .option('--project <name>', 'Select a named project from multi-project config')
  .option('--all', 'Run across all config files in the workspace')
  .action(withAll(lintCommand))

const schema = program.command('schema').description('Schema inspection and comparison')

schema
  .command('inspect')
  .description('Inspect schema from SQL files, directory, or database')
  .argument('[source]', 'SQL file, directory, or database URL (defaults to config schema)')
  .option('-c, --config <path>', 'Path to sqldoc.config.ts')
  .option('-f, --format <format>', 'Output format: sql, json', 'sql')
  .option('--dev-url <url>', 'Dev database URL (pglite, docker://<image>, dockerfile://<path>, postgres://...)')
  .option('--project <name>', 'Select a named project from multi-project config')
  .action(schemaInspectCommand)

schema
  .command('diff')
  .description('Compare two schema states')
  .option('--from <source>', 'Source state: SQL file, directory, or database URL (default: empty)')
  .option('--to <source>', 'Target state: SQL file, directory, or database URL')
  .option('-c, --config <path>', 'Path to sqldoc.config.ts')
  .option('-f, --format <format>', 'Output format: sql, json, pretty', 'sql')
  .option('--dev-url <url>', 'Dev database URL (pglite, docker://<image>, dockerfile://<path>, postgres://...)')
  .option('--check', 'Exit non-zero if schemas differ (CI mode)')
  .option('--project <name>', 'Select a named project from multi-project config')
  .action(schemaDiffCommand)

program
  .command('migrate')
  .description('Generate migration files or check for schema drift')
  .option('-c, --config <path>', 'Path to sqldoc.config.ts')
  .option('--project <name>', 'Select a named project from multi-project config')
  .option('--check', 'Exit non-zero if schema differs from migrations (CI mode)')
  .option('--name <name>', 'Custom migration name')
  .option('--force', 'Allow destructive changes (DROP TABLE, DROP COLUMN, etc.)')
  .option('--all', 'Run across all config files in the workspace')
  .action(withAll(migrateCommand))

program.command('doctor').description('Check project setup and report status').action(doctorCommand)

function serializeCommand(cmd: Command): unknown {
  const args =
    cmd.registeredArguments?.map((a: any) => ({
      name: a.name(),
      description: a.description,
      required: a.required,
    })) ?? []
  const opts =
    cmd.options
      ?.filter((o: any) => o.long !== '--help')
      .map((o: any) => ({
        flags: o.flags,
        description: o.description,
      })) ?? []
  const subs = cmd.commands?.map(serializeCommand)
  return {
    name: cmd.name(),
    description: cmd.description(),
    ...(args.length ? { arguments: args } : {}),
    ...(opts.length ? { options: opts } : {}),
    ...(subs?.length ? { subcommands: subs } : {}),
  }
}

/** Get machine-readable command listing. Called by the shim for --help. */
export function getCommandInfo(): unknown[] {
  return program.commands.map(serializeCommand)
}

/** Parse argv and run the matched command. Called by main.ts or the shim's delegate. */
export function run(): void {
  // Suppress Node experimental warnings (WASI)
  process.removeAllListeners('warning')

  // Machine-readable command listing for subprocess mode
  if (process.argv.includes('--help-json')) {
    console.log(JSON.stringify(getCommandInfo()))
    process.exit(0)
  }

  // Global handler — force exit on both success and error
  // (pglite/WASI worker threads keep the process alive otherwise)
  program
    .parseAsync()
    .then(() => {
      process.exit(0)
    })
    .catch((err) => {
      if (err instanceof CliError) {
        console.error(pc.red(err.message))
        process.exit(err.exitCode)
      }
      if (err?.code === 'ECONNREFUSED') {
        console.error(pc.red('Cannot connect to database. Is it running?'))
        process.exit(1)
      }
      console.error(pc.red(err?.message ?? String(err)))
      if (err?.stack) console.error(pc.dim(err.stack))
      process.exit(1)
    })
}
