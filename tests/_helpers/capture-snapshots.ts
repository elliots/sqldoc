/**
 * Capture ground-truth snapshots from the current Atlas WASI binary.
 *
 * Runs each test schema through the Atlas WASI runner and saves the full
 * AtlasRealm output as JSON snapshot files. These snapshots serve as the
 * "before" state for verifying the TypeScript port of the inspector.
 *
 * Usage: bun run tests/_helpers/capture-snapshots.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRunner, extractExtensions } from '@sqldoc/db'

const snapshotDir = path.join(import.meta.dirname, 'snapshots', 'inspector')
const testsDir = path.resolve(import.meta.dirname, '..')

interface SchemaConfig {
  name: string
  dialect: 'postgres' | 'mysql' | 'sqlite' | 'mssql'
  files: string[]
  devUrl?: string
  /** SQL to prepend before the schema files (e.g. role creation) */
  preamble?: string
  /** Postgres extensions needed by the schema */
  extensions?: string[]
}

// pagila uses OWNER TO postgres — ensure the role exists
const pagilaPreamble = `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres SUPERUSER; END IF; END $$;\n`

const schemas: SchemaConfig[] = [
  {
    name: 'pagila',
    dialect: 'postgres',
    files: [path.join(testsDir, 'pagila', 'pagila-schema.sql')],
    preamble: pagilaPreamble,
  },
  {
    name: 'kitchen-sink',
    dialect: 'postgres',
    files: [path.join(testsDir, 'postgraphile-kitchensink', 'kitchen-sink-schema.sql')],
  },
  {
    name: 'pet-store-postgres',
    dialect: 'postgres',
    files: [path.join(testsDir, 'pet-store-postgres', 'schema.sql')],
  },
  {
    name: 'pet-store-sqlite',
    dialect: 'sqlite',
    files: [
      path.join(testsDir, 'pet-store-sqlite', 'schema.sql'),
      path.join(testsDir, 'pet-store-sqlite', 'include', 'reviews.sql'),
      path.join(testsDir, 'pet-store-sqlite', 'external', 'locations.sql'),
    ],
  },
  {
    name: 'pet-store-mysql',
    dialect: 'mysql',
    devUrl: 'docker://mysql:8',
    files: [path.join(testsDir, 'pet-store-mysql', 'schema.sql')],
  },
]

async function captureSnapshot(config: SchemaConfig): Promise<boolean> {
  const outFile = path.join(snapshotDir, `${config.name}.json`)
  console.log(`\nCapturing ${config.name} (${config.dialect})...`)

  try {
    const fileSqls = config.files.map((f) => fs.readFileSync(f, 'utf-8'))

    // Auto-detect extensions from SQL for Postgres schemas
    let extensions = config.extensions
    if (!extensions && config.dialect === 'postgres') {
      const extracted = extractExtensions(fileSqls)
      if (extracted.extensions.length > 0) {
        extensions = extracted.extensions
        console.log(`  Extensions detected: ${extensions.join(', ')}`)
      }
    }

    // Prepend preamble SQL if provided
    const inspectSqls = config.preamble ? [config.preamble + fileSqls[0], ...fileSqls.slice(1)] : fileSqls

    const runner = await createRunner({
      dialect: config.dialect,
      devUrl: config.devUrl,
      extensions,
    })

    try {
      const result = await runner.inspect(inspectSqls)

      if (result.error) {
        console.error(`  ERROR: ${result.error}`)
        return false
      }

      if (!result.schema) {
        console.error('  ERROR: No schema returned from inspect')
        return false
      }

      fs.writeFileSync(
        outFile,
        `${JSON.stringify(result.schema, (_key, value) => (typeof value === 'bigint' ? Number(value) : value), 2)}\n`,
      )
      const schemas = result.schema.schemas ?? []
      const tables = schemas.flatMap((s) => s.tables ?? [])
      const views = schemas.flatMap((s) => s.views ?? [])
      const funcs = schemas.flatMap((s) => s.funcs ?? [])
      console.log(
        `  OK: ${schemas.length} schemas, ${tables.length} tables, ${views.length} views, ${funcs.length} funcs`,
      )
      console.log(`  Written to ${outFile}`)
      return true
    } finally {
      await runner.close()
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // For mysql with Docker, write placeholder if Docker is unavailable
    if (
      config.dialect === 'mysql' &&
      (message.includes('Docker') ||
        message.includes('docker') ||
        message.includes('ECONNREFUSED') ||
        message.includes('Could not find'))
    ) {
      console.log(`  SKIP (Docker not available): writing placeholder`)
      fs.writeFileSync(
        outFile,
        `${JSON.stringify({ _note: 'Requires Docker - run with Docker available to capture' }, null, 2)}\n`,
      )
      return true
    }
    console.error(`  ERROR: ${message}`)
    return false
  }
}

async function main() {
  fs.mkdirSync(snapshotDir, { recursive: true })
  console.log('Capturing Atlas WASI snapshots...')
  console.log(`Output: ${snapshotDir}`)

  let allOk = true
  for (const schema of schemas) {
    const ok = await captureSnapshot(schema)
    if (!ok) allOk = false
  }

  console.log(allOk ? '\nAll snapshots captured successfully.' : '\nSome snapshots failed. Check output above.')
  process.exit(allOk ? 0 : 1)
}

main()
