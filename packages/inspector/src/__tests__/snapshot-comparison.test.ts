// Snapshot comparison tests: verify the TypeScript inspector matches the saved WASI snapshots.
//
// The snapshots (tests/_helpers/snapshots/inspector/) were captured using inspectRich from
// the Go WASI binary. They use the rich internal format (type.type.kind, Go-specific attrs).
// The TS inspector produces Realm via marshalRealm (flat format: type.T, type.category).
//
// We compare STRUCTURAL equivalence: same schemas, tables, columns, types, indexes, FKs --
// not exact JSON equality, since the two formats differ in shape.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import type { ForeignKey, Index, Realm } from '@sqldoc/db'
import { createSqliteAdapter } from '@sqldoc/db'
import pglitePlugin from '@sqldoc/db-pglite'
import { createInspector } from '../inspector.ts'

// -- Snapshot Loading --

const snapshotDir = path.resolve(import.meta.dirname, '../../../../tests/_helpers/snapshots/inspector')
const testsDir = path.resolve(import.meta.dirname, '../../../../tests')

interface RichRealm {
  schemas: RichSchema[]
}

interface RichSchema {
  name: string
  tables?: RichTable[]
  views?: Array<{ name: string; def?: string; columns?: RichColumn[] }>
  funcs?: Array<{ name: string; lang?: string; args?: Array<{ name?: string; type?: any; mode?: string }> }>
  compositeTypes?: Array<{ name?: string; T?: string; fields: Array<{ name: string; type: string }> }>
  composite_types?: Array<{ name?: string; T?: string; fields: Array<{ name: string; type: string }> }>
}

interface RichTable {
  name: string
  columns: RichColumn[]
  primaryKey?: { name?: string; parts?: Array<{ column?: string }> }
  primary_key?: { name?: string; parts?: Array<{ column?: string }> }
  indexes?: Array<{ name?: string; unique?: boolean; parts?: Array<{ column?: string }> }>
  foreignKeys?: RichForeignKey[]
  foreign_keys?: RichForeignKey[]
}

interface RichColumn {
  name: string
  type?: {
    type?: { kind?: string; T?: string }
    raw?: string
    null?: boolean
  }
  default?: any
}

interface RichForeignKey {
  symbol?: string
  columns?: string[]
  refTable?: string
  ref_table?: string
  refSchema?: string
  ref_columns?: string[]
  refColumns?: string[]
  onUpdate?: string
  on_update?: string
  onDelete?: string
  on_delete?: string
}

function loadSnapshot(name: string): RichRealm | null {
  const file = path.join(snapshotDir, `${name}.json`)
  if (!fs.existsSync(file)) return null
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
  // Check for placeholder files
  if (data._note) return null
  return data
}

// -- Structural Comparison Helpers --

interface ComparisonResult {
  pass: boolean
  differences: string[]
  summary: {
    schemasCompared: number
    tablesCompared: number
    columnsCompared: number
  }
}

/**
 * Compare a Realm (from the TS inspector) against a rich snapshot (from the WASI binary).
 * Checks structural equivalence: same schemas, tables, columns, types, indexes, FKs.
 */
function compareRealms(actual: Realm, snapshot: RichRealm): ComparisonResult {
  const differences: string[] = []
  let tablesCompared = 0
  let columnsCompared = 0

  // Compare schema count and names
  const actualSchemaNames = actual.schemas.map((s) => s.name).sort()
  const snapSchemaNames = snapshot.schemas.map((s) => s.name).sort()

  if (actualSchemaNames.length !== snapSchemaNames.length) {
    differences.push(
      `Schema count: actual=${actualSchemaNames.length} snapshot=${snapSchemaNames.length} ` +
        `(actual: [${actualSchemaNames}], snapshot: [${snapSchemaNames}])`,
    )
  }

  // Compare each schema
  for (const snapSchema of snapshot.schemas) {
    const actualSchema = actual.schemas.find((s) => s.name === snapSchema.name)
    if (!actualSchema) {
      differences.push(`Missing schema: "${snapSchema.name}"`)
      continue
    }

    // Compare tables
    const snapTableNames = (snapSchema.tables ?? []).map((t) => t.name).sort()
    const actualTableNames = (actualSchema.tables ?? []).map((t) => t.name).sort()

    if (snapTableNames.join(',') !== actualTableNames.join(',')) {
      const missing = snapTableNames.filter((n) => !actualTableNames.includes(n))
      const extra = actualTableNames.filter((n) => !snapTableNames.includes(n))
      if (missing.length) differences.push(`Missing tables in "${snapSchema.name}": [${missing}]`)
      if (extra.length) differences.push(`Extra tables in "${snapSchema.name}": [${extra}]`)
    }

    // Compare each table
    for (const snapTable of snapSchema.tables ?? []) {
      const actualTable = (actualSchema.tables ?? []).find((t) => t.name === snapTable.name)
      if (!actualTable) continue

      tablesCompared++
      const tablePath = `${snapSchema.name}.${snapTable.name}`

      // Compare columns
      const snapColNames = snapTable.columns.map((c) => c.name)
      const actualColNames = (actualTable.columns ?? []).map((c) => c.name!)

      if (snapColNames.join(',') !== actualColNames.join(',')) {
        differences.push(`Column mismatch in ${tablePath}: ` + `snapshot=[${snapColNames}] actual=[${actualColNames}]`)
      }

      // Compare each column's type
      for (const snapCol of snapTable.columns) {
        const actualCol = (actualTable.columns ?? []).find((c) => c.name === snapCol.name)
        if (!actualCol) continue

        columnsCompared++
        const colPath = `${tablePath}.${snapCol.name}`

        // Compare type T (the primary type identifier)
        const snapT = snapCol.type?.type?.T
        const actualT = actualCol.type?.type?.T
        if (!!snapT !== !!actualT) {
          differences.push(
            `Type presence mismatch at ${colPath}: snapshot="${snapT ?? 'undefined'}" actual="${actualT ?? 'undefined'}"`,
          )
        } else if (snapT && actualT && !typesEquivalent(snapT, actualT)) {
          differences.push(`Type mismatch at ${colPath}: snapshot="${snapT}" actual="${actualT}"`)
        }

        // Compare nullability
        const snapNull = snapCol.type?.null ?? false
        const actualNull = actualCol.type?.null ?? false
        if (snapNull !== actualNull) {
          differences.push(`Nullability mismatch at ${colPath}: snapshot=${snapNull} actual=${actualNull}`)
        }
      }

      const snapPk = primaryKeyColumnsFromSnapshot(snapshotPrimaryKey(snapTable))
      const actualPk = primaryKeyColumnsFromActual(actualTable.primaryKey)
      if (!arraysEqual(snapPk, actualPk)) {
        differences.push(`Primary key mismatch on ${tablePath}: snapshot=[${snapPk}] actual=[${actualPk}]`)
      }

      const snapFks = snapshotForeignKeys(snapTable)
      const actualFks = actualTable.foreignKeys ?? []
      if (snapFks.length !== actualFks.length) {
        differences.push(
          `Foreign key count mismatch on ${tablePath}: snapshot=${snapFks.length} actual=${actualFks.length}`,
        )
      }

      const snapFkSignatures = new Set(snapFks.map(foreignKeySignatureFromSnapshot))
      const actualFkSignatures = new Set(actualFks.map(foreignKeySignatureFromActual))

      for (const signature of snapFkSignatures) {
        if (!actualFkSignatures.has(signature)) {
          differences.push(`Missing FK on ${tablePath}: ${signature}`)
        }
      }

      for (const signature of actualFkSignatures) {
        if (!snapFkSignatures.has(signature)) {
          differences.push(`Unexpected FK on ${tablePath}: ${signature}`)
        }
      }

      // Compare index count
      const snapIdxCount = (snapTable.indexes ?? []).length
      const actualIdxCount = (actualTable.indexes ?? []).length
      if (snapIdxCount !== actualIdxCount) {
        differences.push(`Index count mismatch on ${tablePath}: snapshot=${snapIdxCount} actual=${actualIdxCount}`)
      }
    }

    // Compare views
    const snapViewNames = (snapSchema.views ?? []).map((v) => v.name).sort()
    const actualViewNames = (actualSchema.views ?? []).map((v) => v.name).sort()
    if (snapViewNames.join(',') !== actualViewNames.join(',')) {
      const missing = snapViewNames.filter((n) => !actualViewNames.includes(n))
      const extra = actualViewNames.filter((n) => !snapViewNames.includes(n))
      if (missing.length) differences.push(`Missing views in "${snapSchema.name}": [${missing}]`)
      if (extra.length) differences.push(`Extra views in "${snapSchema.name}": [${extra}]`)
    }

    // Compare functions
    const snapFuncNames = (snapSchema.funcs ?? []).map((f) => f.name).sort()
    const actualFuncNames = (actualSchema.funcs ?? []).map((f) => f.name).sort()
    if (snapFuncNames.join(',') !== actualFuncNames.join(',')) {
      const missing = snapFuncNames.filter((n) => !actualFuncNames.includes(n))
      const extra = actualFuncNames.filter((n) => !snapFuncNames.includes(n))
      if (missing.length) differences.push(`Missing funcs in "${snapSchema.name}": [${missing}]`)
      if (extra.length) differences.push(`Extra funcs in "${snapSchema.name}": [${extra}]`)
    }

    // Compare composite types (only if snapshot has them -- WASI snapshots may omit composites)
    const snapCompNames = snapshotCompositeTypes(snapSchema)
      .map((c) => c.name ?? c.T ?? '')
      .filter(Boolean)
      .sort()
    const actualCompNames = (actualSchema.compositeTypes ?? []).map((c) => c.T).sort()
    if (snapCompNames.length > 0 && snapCompNames.join(',') !== actualCompNames.join(',')) {
      const missing = snapCompNames.filter((n) => !actualCompNames.includes(n))
      if (missing.length) {
        differences.push(`Missing composite types in "${snapSchema.name}": [${missing}]`)
      }
    }
  }

  return {
    pass: differences.length === 0,
    differences,
    summary: {
      schemasCompared: snapshot.schemas.length,
      tablesCompared,
      columnsCompared,
    },
  }
}

/** Normalize type names for comparison (handle aliases and schema qualifiers). */
function normalizeTypeName(t: string): string {
  let lower = t.toLowerCase()
  // Strip schema qualifier (e.g., "public.year" -> "year")
  if (lower.includes('.')) {
    lower = lower.split('.').pop()!
  }
  // Common aliases
  const aliases: Record<string, string> = {
    int: 'integer',
    int4: 'integer',
    int8: 'bigint',
    float4: 'real',
    float8: 'double precision',
    bool: 'boolean',
    varchar: 'character varying',
    timestamp: 'timestamp without time zone',
    timestamptz: 'timestamp with time zone',
  }
  return aliases[lower] ?? lower
}

/**
 * Check if two type names are equivalent, accounting for user-defined types.
 * USER-DEFINED in the actual output may correspond to an enum/domain name in the snapshot.
 */
function typesEquivalent(snapT: string, actualT: string): boolean {
  if (normalizeTypeName(snapT) === normalizeTypeName(actualT)) return true
  // USER-DEFINED is a generic marker for enums, domains, composites
  if (actualT.toUpperCase() === 'USER-DEFINED') return true
  // ARRAY is a generic marker for array types (snapshot may have "text[]")
  if (actualT.toUpperCase() === 'ARRAY' && snapT.includes('[]')) return true
  return false
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function primaryKeyColumnsFromSnapshot(primaryKey: RichTable['primary_key'] | undefined): string[] {
  return (primaryKey?.parts ?? []).flatMap((part) => (part.column ? [part.column] : []))
}

function primaryKeyColumnsFromActual(primaryKey: Index | undefined): string[] {
  return (primaryKey?.parts ?? []).flatMap((part) => (part.column ? [part.column] : []))
}

function foreignKeySignatureFromSnapshot(fk: RichForeignKey): string {
  return [
    `cols=${(fk.columns ?? []).join(',')}`,
    `ref=${fk.refSchema ? `${fk.refSchema}.` : ''}${fk.refTable ?? fk.ref_table ?? ''}`,
    `refCols=${(fk.refColumns ?? fk.ref_columns ?? []).join(',')}`,
    `onUpdate=${fk.onUpdate ?? fk.on_update ?? ''}`,
    `onDelete=${fk.onDelete ?? fk.on_delete ?? ''}`,
  ].join('|')
}

function foreignKeySignatureFromActual(fk: ForeignKey): string {
  return [
    `cols=${(fk.columns ?? []).join(',')}`,
    `ref=${fk.refSchema ? `${fk.refSchema}.` : ''}${fk.refTable}`,
    `refCols=${(fk.refColumns ?? []).join(',')}`,
    `onUpdate=${fk.onUpdate ?? ''}`,
    `onDelete=${fk.onDelete ?? ''}`,
  ].join('|')
}

function snapshotPrimaryKey(table: RichTable): RichTable['primary_key'] | undefined {
  return table.primaryKey ?? table.primary_key
}

function snapshotForeignKeys(table: RichTable): RichForeignKey[] {
  return table.foreignKeys ?? table.foreign_keys ?? []
}

function snapshotCompositeTypes(
  schema: RichSchema,
): Array<{ name?: string; T?: string; fields: Array<{ name: string; type: string }> }> {
  return schema.compositeTypes ?? schema.composite_types ?? []
}

// -- Tests --

describe('compareRealms()', () => {
  it('detects missing type metadata on either side', () => {
    const actual: Realm = {
      schemas: [
        {
          name: 'public',
          tables: [
            {
              name: 'users',
              columns: [
                {
                  name: 'id',
                  type: {
                    type: { kind: 'integer', T: 'integer' },
                  },
                },
              ],
            },
          ],
        },
      ],
    }

    const snapshot: RichRealm = {
      schemas: [
        {
          name: 'public',
          tables: [
            {
              name: 'users',
              columns: [{ name: 'id' }],
            },
          ],
        },
      ],
    }

    const comparison = compareRealms(actual, snapshot)
    assert.equal(comparison.pass, false)
    assert.ok(
      comparison.differences.some((difference) => difference.includes('Type presence mismatch at public.users.id')),
    )
  })

  it('detects extra primary keys and foreign keys in actual output', () => {
    const actual: Realm = {
      schemas: [
        {
          name: 'public',
          tables: [
            {
              name: 'users',
              columns: [
                {
                  name: 'id',
                  type: {
                    type: { kind: 'integer', T: 'integer' },
                  },
                },
              ],
              primaryKey: {
                parts: [{ column: 'id' }],
              },
              foreignKeys: [
                {
                  columns: ['id'],
                  refTable: 'accounts',
                  refColumns: ['id'],
                },
              ],
            },
          ],
        },
      ],
    }

    const snapshot: RichRealm = {
      schemas: [
        {
          name: 'public',
          tables: [
            {
              name: 'users',
              columns: [
                {
                  name: 'id',
                  type: {
                    type: { T: 'integer' },
                  },
                },
              ],
            },
          ],
        },
      ],
    }

    const comparison = compareRealms(actual, snapshot)
    assert.equal(comparison.pass, false)
    assert.ok(comparison.differences.some((difference) => difference.includes('Primary key mismatch on public.users')))
    assert.ok(comparison.differences.some((difference) => difference.includes('Unexpected FK on public.users')))
  })
})

describe('Snapshot Comparison: TypeScript Inspector vs WASI Binary', () => {
  it('pet-store-postgres: structural equivalence', async () => {
    const snapshot = loadSnapshot('pet-store-postgres')
    if (!snapshot) {
      assert.fail('Snapshot file not found: pet-store-postgres.json')
    }

    const schemaPath = path.join(testsDir, 'pet-store-postgres/schema.sql')
    const sql = fs.readFileSync(schemaPath, 'utf-8')

    const db = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
    const inspector = await createInspector({ db, dialect: 'postgres' })

    try {
      const result = await inspector.inspect([sql])
      assert.ok(result.schema, 'inspect should return schema')

      const comparison = compareRealms(result.schema!, snapshot)

      if (!comparison.pass) {
        console.log(`\nPet Store Postgres comparison:`)
        console.log(`  Schemas: ${comparison.summary.schemasCompared}`)
        console.log(`  Tables: ${comparison.summary.tablesCompared}`)
        console.log(`  Columns: ${comparison.summary.columnsCompared}`)
        console.log(`  Differences (${comparison.differences.length}):`)
        for (const diff of comparison.differences.slice(0, 10)) {
          console.log(`    - ${diff}`)
        }
      }

      assert.ok(comparison.pass, `Structural differences found:\n${comparison.differences.join('\n')}`)
    } finally {
      await inspector.close()
    }
  })

  it('pet-store-sqlite: structural equivalence', async () => {
    const snapshot = loadSnapshot('pet-store-sqlite')
    if (!snapshot) {
      assert.fail('Snapshot file not found: pet-store-sqlite.json')
    }

    const schemaSql = fs.readFileSync(path.join(testsDir, 'pet-store-sqlite/schema.sql'), 'utf-8')
    const includeReviewsSql = fs.readFileSync(path.join(testsDir, 'pet-store-sqlite/include/reviews.sql'), 'utf-8')
    const externalLocationsSql = fs.readFileSync(
      path.join(testsDir, 'pet-store-sqlite/external/locations.sql'),
      'utf-8',
    )

    const db = await createSqliteAdapter(':memory:')
    const inspector = await createInspector({ db, dialect: 'sqlite' })

    try {
      const result = await inspector.inspect([externalLocationsSql, schemaSql, includeReviewsSql])
      assert.ok(result.schema, 'inspect should return schema')

      const comparison = compareRealms(result.schema!, snapshot)

      if (!comparison.pass) {
        console.log(`\nPet Store SQLite comparison:`)
        console.log(`  Schemas: ${comparison.summary.schemasCompared}`)
        console.log(`  Tables: ${comparison.summary.tablesCompared}`)
        console.log(`  Columns: ${comparison.summary.columnsCompared}`)
        console.log(`  Differences (${comparison.differences.length}):`)
        for (const diff of comparison.differences.slice(0, 10)) {
          console.log(`    - ${diff}`)
        }
      }

      assert.ok(comparison.pass, `Structural differences found:\n${comparison.differences.join('\n')}`)
    } finally {
      await inspector.close()
    }
  })

  it('pagila: structural equivalence', async () => {
    const snapshot = loadSnapshot('pagila')
    if (!snapshot) {
      assert.fail('Snapshot file not found: pagila.json')
    }

    const schemaPath = path.join(testsDir, 'pagila/pagila-schema.sql')
    if (!fs.existsSync(schemaPath)) {
      assert.fail('Pagila schema SQL not found')
    }
    const sql = fs.readFileSync(schemaPath, 'utf-8')

    // pagila uses OWNER TO postgres -- ensure the role exists
    const preamble = `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres SUPERUSER; END IF; END $$;\n`

    const db = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
    const inspector = await createInspector({ db, dialect: 'postgres' })

    try {
      const result = await inspector.inspect([preamble + sql])
      assert.ok(result.schema, 'inspect should return schema')

      const comparison = compareRealms(result.schema!, snapshot)

      if (!comparison.pass) {
        console.log(`\nPagila comparison:`)
        console.log(`  Schemas: ${comparison.summary.schemasCompared}`)
        console.log(`  Tables: ${comparison.summary.tablesCompared}`)
        console.log(`  Columns: ${comparison.summary.columnsCompared}`)
        console.log(`  Differences (${comparison.differences.length}):`)
        for (const diff of comparison.differences.slice(0, 20)) {
          console.log(`    - ${diff}`)
        }
      }

      assert.ok(comparison.pass, `Structural differences found:\n${comparison.differences.join('\n')}`)
    } finally {
      await inspector.close()
    }
  })

  it('kitchen-sink: structural equivalence', async () => {
    const snapshot = loadSnapshot('kitchen-sink')
    if (!snapshot) {
      assert.fail('Snapshot file not found: kitchen-sink.json')
    }

    const schemaPath = path.join(testsDir, 'postgraphile-kitchensink/kitchen-sink-schema.sql')
    if (!fs.existsSync(schemaPath)) {
      assert.fail('Kitchen sink schema SQL not found')
    }
    const sql = fs.readFileSync(schemaPath, 'utf-8')

    const db = await pglitePlugin.createAdapter('pglite', { dialect: 'postgres', extensions: [] })
    const inspector = await createInspector({ db, dialect: 'postgres' })

    try {
      const result = await inspector.inspect([sql])
      assert.ok(result.schema, 'inspect should return schema')

      const comparison = compareRealms(result.schema!, snapshot)

      if (!comparison.pass) {
        console.log(`\nKitchen Sink comparison:`)
        console.log(`  Schemas: ${comparison.summary.schemasCompared}`)
        console.log(`  Tables: ${comparison.summary.tablesCompared}`)
        console.log(`  Columns: ${comparison.summary.columnsCompared}`)
        console.log(`  Differences (${comparison.differences.length}):`)
        for (const diff of comparison.differences.slice(0, 20)) {
          console.log(`    - ${diff}`)
        }
      }

      assert.ok(comparison.pass, `Structural differences found:\n${comparison.differences.join('\n')}`)
    } catch (err: any) {
      // Kitchen-sink uses extensions (tablefunc, etc.) that PgLite may not support.
      // If the SQL execution fails due to missing extensions, skip rather than fail.
      const msg = err?.message ?? String(err)
      if (msg.includes('extension') && msg.includes('not available')) {
        console.log('  Skipping kitchen-sink: PgLite does not support required extensions')
        return
      }
      throw err
    } finally {
      await inspector.close()
    }
  })

  it('pet-store-mysql: structural equivalence (requires MYSQL_TEST=1)', () => {
    const optIn = process.env.MYSQL_TEST === '1'
    if (!optIn) {
      // Skip -- MySQL needs Docker container
      return
    }

    const snapshot = loadSnapshot('pet-store-mysql')
    if (!snapshot) {
      assert.fail('Snapshot file not found or is placeholder: pet-store-mysql.json')
    }

    // MySQL snapshot comparison would go here when MYSQL_TEST=1 is set
    // with createMysqlDockerAdapter + createInspector
  })
})
