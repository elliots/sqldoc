import * as path from 'node:path'
import * as readline from 'node:readline'
import type { AtlasRename, AtlasRenameCandidate } from '@sqldoc/db'
import { createRunner } from '@sqldoc/db'
import type { CompilerOutput, ResolvedConfig } from '@sqldoc/core'
import { loadConfig, resolveProject } from '@sqldoc/core'
import pc from 'picocolors'
import { CliError, formatPipelineError } from '../errors.ts'
import { detectDestructiveChanges } from '../utils/destructive.ts'
import { concatUpScripts, readMigrations, writeMigration } from '../utils/migration-formats.ts'
import { runCompilePipeline } from '../utils/pipeline.ts'
import { printChanges } from '../utils/pretty-changes.ts'

/**
 * migrate command: generate migration files or check for schema drift.
 *
 * Flow:
 * 1. Read config's migrations.dir -> parse up scripts based on migrations.format
 * 2. Apply up scripts in order to dev DB -> get "current" realm
 * 3. Compile schema files through pipeline -> get "desired" realm
 * 4. Diff current vs desired -> up SQL
 * 5. Diff desired vs current -> down SQL
 * 6. Detect renames via @docs.previously and Atlas-side candidate detection
 * 7. Check for destructive changes (unless --force)
 * 8. If --check: exit 0 if no diff, non-zero if drift
 * 9. Otherwise: write migration file in configured format
 */
export async function migrateCommand(options: {
  config?: string
  project?: string
  check?: boolean
  name?: string
  force?: boolean
}): Promise<void> {
  const configRoot = options.config
    ? path.dirname(path.resolve(options.config))
    : process.env.SQLDOC_PROJECT_ROOT || process.cwd()
  const { config: rawConfig } = await loadConfig(configRoot, options.config)
  const config: ResolvedConfig = resolveProject(rawConfig, options.project)

  if (!config.schema) {
    throw new CliError('No "schema" configured. Set "schema" in sqldoc.config.ts')
  }

  if (!config.migrations?.dir) {
    throw new CliError('No "migrations.dir" configured. Set "migrations.dir" in sqldoc.config.ts')
  }

  const dialect = config.dialect
  const format = config.migrations.format ?? 'plain'
  const namingConfig = config.migrations.naming ?? 'timestamp'

  // Resolve naming strategy — AI naming falls back to provided --name or generic
  let naming: 'timestamp' | 'sequential'
  if (typeof namingConfig === 'object' && namingConfig.provider === 'claude-code') {
    naming = 'timestamp' // AI naming still uses timestamp prefix, name comes from AI
  } else {
    naming = namingConfig as 'timestamp' | 'sequential'
  }

  // ── Step 1: Read existing migrations ────────────────────────────────
  const migrationsDir = path.resolve(configRoot, config.migrations.dir)
  const existingMigrations = readMigrations(migrationsDir, format)
  const currentSql = concatUpScripts(existingMigrations)

  console.error(pc.cyan(`Found ${existingMigrations.length} existing migration(s) in ${config.migrations.dir}`))

  // ── Step 2: Compile schema files -> "desired" state ────────────────
  let desiredSql: string
  let pipelineResult: Awaited<ReturnType<typeof runCompilePipeline>>
  try {
    pipelineResult = await runCompilePipeline(path.resolve(configRoot, config.schema), config, configRoot)
    if (pipelineResult.totalErrors > 0) {
      throw new CliError(`${pipelineResult.totalErrors} compilation error(s) — fix before migrating`)
    }
    desiredSql = pipelineResult.mergedSql
  } catch (err: any) {
    if (err instanceof CliError) throw err
    throw formatPipelineError(err, config)
  }

  // ── Step 3: Build known renames from @docs.previously tags ─────────
  const knownRenames = buildRenamesFromPreviously(pipelineResult.outputs)

  if (knownRenames.length > 0) {
    for (const r of knownRenames) {
      const desc = r.type === 'column' ? `${r.table}.${r.oldName} -> ${r.newName}` : `${r.oldName} -> ${r.newName}`
      console.error(pc.cyan(`  Rename (via @docs.previously): ${desc}`))
    }
  }

  // ── Step 4: Diff current -> desired (up migration) ─────────────────
  const schemaOpt = dialect === 'postgres' ? 'public' : undefined

  // We need a runner that has both SQL contents loaded for extension detection
  const allSql = [currentSql, desiredSql].filter(Boolean)
  const runner = await createRunner({ dialect, devUrl: config.devUrl, sqlFiles: allSql })

  let upStatements: string[]
  let upChanges: import('@sqldoc/db').AtlasChange[] | undefined
  let downStatements: string[]

  try {
    // First diff: pass known renames, get back SQL + candidates
    const upResult = await runner.diff(currentSql ? [currentSql] : [], [desiredSql], {
      schema: schemaOpt,
      dialect,
      renames: knownRenames.length > 0 ? knownRenames : undefined,
    })

    if (upResult.error) {
      throw new CliError(`Schema diff error: ${upResult.error}`)
    }

    upStatements = upResult.statements ?? []
    upChanges = upResult.changes
    const candidates = upResult.renameCandidates ?? []

    // ── Step 4a: Interactive rename prompting (TTY only) ──────────────
    if (candidates.length > 0 && process.stdin.isTTY) {
      const accepted = await promptRenameCandidates(candidates)
      if (accepted.length > 0) {
        // Re-diff with the accepted renames added to the known set
        const allRenames = [...knownRenames, ...accepted]
        const rediffResult = await runner.diff(currentSql ? [currentSql] : [], [desiredSql], {
          schema: schemaOpt,
          dialect,
          renames: allRenames,
        })

        if (rediffResult.error) {
          throw new CliError(`Schema diff (with renames) error: ${rediffResult.error}`)
        }

        upStatements = rediffResult.statements ?? []
        upChanges = rediffResult.changes
      }
    }

    // ── Step 5: Diff desired -> current (down migration) ──────────────
    const downResult = await runner.diff([desiredSql], currentSql ? [currentSql] : [], { schema: schemaOpt, dialect })

    if (downResult.error) {
      throw new CliError(`Schema diff (reverse) error: ${downResult.error}`)
    }

    downStatements = downResult.statements ?? []
  } finally {
    await runner.close()
  }

  // ── Step 6: Handle --check mode ────────────────────────────────────
  if (options.check) {
    if (upStatements.length === 0) {
      console.error(pc.green('Schema is in sync with migrations. No drift detected.'))
      return
    }

    console.error(pc.red(pc.bold('Schema drift detected!')))
    console.error('')
    for (const stmt of upStatements) {
      console.error(pc.yellow(`  ${stmt};`))
    }
    console.error('')
    console.error(`  ${upStatements.length} statement(s) needed to reach desired state`)
    throw new CliError('Schema drift detected', 1)
  }

  // ── Step 7: Generate migration file ────────────────────────────────
  if (upStatements.length === 0) {
    console.error(pc.green('No schema changes detected. Nothing to migrate.'))
    return
  }

  // Show structured change summary if available
  if (upChanges && upChanges.length > 0) {
    printChanges(upChanges, pc.cyan(pc.bold('Changes:')))
  }

  // ── Step 7a: Destructive change detection ──────────────────────────
  const destructiveChanges = detectDestructiveChanges(upStatements)

  if (destructiveChanges.length > 0 && !options.force) {
    console.error(pc.red(pc.bold('Error: Migration contains destructive changes:')))
    for (const change of destructiveChanges) {
      console.error(pc.red(`  - ${change.description}`))
    }
    console.error('')
    console.error('Use --force to generate the migration anyway.')
    throw new CliError('Migration contains destructive changes. Use --force to proceed.', 1)
  }

  if (destructiveChanges.length > 0 && options.force) {
    console.error(pc.yellow(`Warning: ${destructiveChanges.length} destructive change(s) included (--force)`))
  }

  // Determine migration name
  let migrationName = options.name ?? ''

  // AI naming: pipe diff SQL to claude-code for a name
  if (typeof namingConfig === 'object' && namingConfig.provider === 'claude-code' && !options.name) {
    migrationName = await aiMigrationName(upStatements)
  }

  if (!migrationName) {
    migrationName = 'migration'
  }

  // Build up/down SQL content
  const upSql = upStatements.map((s) => `${s};`).join('\n')
  const downSql = downStatements.length > 0 ? downStatements.map((s) => `${s};`).join('\n') : undefined

  const writtenFiles = writeMigration({
    dir: migrationsDir,
    name: migrationName,
    up: upSql,
    down: downSql,
    format,
    naming,
    existing: existingMigrations,
  })

  for (const file of writtenFiles) {
    const rel = path.relative(process.cwd(), file)
    console.error(pc.green(`Created ${rel}`))
  }

  console.error('')
  console.error(`  ${upStatements.length} statement(s) in up migration`)
  if (downStatements.length > 0) {
    console.error(`  ${downStatements.length} statement(s) in down migration`)
  }
}

// ── Internal helpers ──────────────────────────────────────────────────

/**
 * Build a list of known renames from @docs.previously tags in compiled outputs.
 * Scans fileTags for tags with namespace "docs" and tag "previously".
 */
export function buildRenamesFromPreviously(outputs: CompilerOutput[]): AtlasRename[] {
  const renames: AtlasRename[] = []

  for (const output of outputs) {
    for (const fileTag of output.fileTags) {
      for (const tag of fileTag.tags) {
        if (tag.namespace === 'docs' && tag.tag === 'previously') {
          const args = tag.args as unknown[]
          if (args.length > 0 && typeof args[0] === 'string') {
            const oldName = args[0]

            if (fileTag.target === 'column') {
              // objectName is "table.column" for columns
              const dotIdx = fileTag.objectName.lastIndexOf('.')
              if (dotIdx !== -1) {
                const tableName = fileTag.objectName.substring(0, dotIdx)
                const newColName = fileTag.objectName.substring(dotIdx + 1)
                renames.push({
                  type: 'column',
                  table: tableName,
                  oldName,
                  newName: newColName,
                })
              }
            } else if (fileTag.target === 'table') {
              renames.push({
                type: 'table',
                table: fileTag.objectName,
                oldName,
                newName: fileTag.objectName,
              })
            }
          }
        }
      }
    }
  }

  return renames
}

/**
 * Prompt the user interactively for rename candidates detected by Atlas.
 * Returns the list of accepted renames as AtlasRename objects.
 */
async function promptRenameCandidates(candidates: AtlasRenameCandidate[]): Promise<AtlasRename[]> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  })

  const accepted: AtlasRename[] = []

  for (const candidate of candidates) {
    const typeLabel = candidate.type === 'column' ? 'Column' : 'Table'
    const typeInfo = candidate.colType ? ` (${candidate.colType})` : ''
    const context =
      candidate.type === 'column'
        ? `${typeLabel} '${candidate.oldName}' was removed and '${candidate.newName}'${typeInfo} was added on table '${candidate.table}'.`
        : `${typeLabel} '${candidate.oldName}' was removed and '${candidate.newName}' was added.`

    const answer = await new Promise<string>((resolve) => {
      rl.question(`${context} Is this a rename? (Y/n) `, resolve)
    })

    const normalized = answer.trim().toLowerCase()
    if (normalized === '' || normalized === 'y' || normalized === 'yes') {
      accepted.push({
        type: candidate.type,
        table: candidate.table,
        oldName: candidate.oldName,
        newName: candidate.newName,
      })
    }
  }

  rl.close()
  return accepted
}

/**
 * Use claude-code CLI to generate a migration name from diff SQL.
 * Falls back to 'migration' if claude-code is not available.
 */
async function aiMigrationName(statements: string[]): Promise<string> {
  try {
    const { execSync } = await import('node:child_process')
    const diffSql = statements.join(';\n')
    const result = execSync(
      `echo ${JSON.stringify(diffSql)} | claude -p "Name this migration in 3-5 words, snake_case, no prefix. Output ONLY the name, nothing else."`,
      { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const name = result
      .trim()
      .replace(/[^a-z0-9_]/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
    if (name && name.length > 2 && name.length < 60) {
      return name
    }
  } catch {
    // claude-code not available or failed — fall back silently
  }
  return 'migration'
}
