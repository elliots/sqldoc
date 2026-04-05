/**
 * Neon ephemeral database adapter for sqldoc.
 *
 * Creates a temporary Neon database on first use, caches the connection
 * URL in .sqldoc/neon-temporary.json, and reuses it for 72 hours.
 *
 * Uses @neondatabase/serverless for the connection (WebSocket transport,
 * works in Node, Bun, and edge environments).
 *
 * On each run:
 * 1. Load or create the database (cached for 72h)
 * 2. Acquire advisory lock (blocks if another sqldoc process is using it)
 * 3. Wipe all schemas (clean slate)
 * 4. Release lock on close
 *
 * devUrl: just 'neon-temporary' (no URL needed)
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Client } from '@neondatabase/serverless'
import type { AdapterPluginContext, DatabaseAdapter, DatabaseAdapterPlugin, ExecResult, QueryResult } from '@sqldoc/db'
import { normalizeValue } from '@sqldoc/db'

const log = (msg: string) => console.error(`[neon-temporary] ${msg}`)

/** Advisory lock key — "SqLD" in hex */
const LOCK_KEY = 0x5371_4c44

const NEON_API = 'https://neon.new/api/v1/database'
const NEON_CLAIM = 'https://neon.new/database'
const REFERRER = 'npm:neon-new|https://sqldoc.dev'
const CACHE_FILE = 'neon-temporary.json'
const MAX_AGE_MS = 72 * 60 * 60 * 1000

interface CachedDb {
  directUrl: string
  poolerUrl: string
  claimUrl: string
  createdAt: string
}

// ── Cache ──────────────────────────────────────────────────────────

function getCachePath(): string | null {
  let dir = process.cwd()
  while (true) {
    const candidate = path.join(dir, '.sqldoc')
    if (fs.existsSync(candidate)) return path.join(candidate, CACHE_FILE)
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function loadCache(): CachedDb | null {
  const cachePath = getCachePath()
  if (!cachePath || !fs.existsSync(cachePath)) return null
  try {
    const data: CachedDb = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
    const age = Date.now() - new Date(data.createdAt).getTime()
    if (age > MAX_AGE_MS) {
      log(`cache expired (${Math.round(age / 3600000)}h old)`)
      return null
    }
    log(`reusing cached database (${Math.round(age / 60000)}m old)`)
    return data
  } catch {
    return null
  }
}

function saveCache(data: CachedDb): void {
  const cachePath = getCachePath()
  if (!cachePath) return
  fs.writeFileSync(cachePath, `${JSON.stringify(data, null, 2)}\n`)
  log(`cached to ${cachePath}`)
}

// ── Neon API ───────────────────────────────────────────────────────

function toPooler(connString: string): string {
  const url = new URL(connString)
  if (url.hostname.includes('pooler')) return connString
  const [first, ...rest] = url.hostname.split('.')
  url.hostname = [`${first}-pooler`, ...rest].join('.')
  return url.href
}

function toDirect(connString: string): string {
  const url = new URL(connString)
  if (!url.hostname.includes('pooler')) return connString
  const [first, ...rest] = url.hostname.split('.')
  url.hostname = [first.replace('-pooler', ''), ...rest].join('.')
  return url.href
}

async function createNeonDatabase(): Promise<CachedDb> {
  log('creating new Neon database...')

  const dbId = randomUUID()
  const createUrl = `${NEON_API}/${dbId}?referrer=${encodeURIComponent(REFERRER)}`

  log(`POST ${createUrl}`)
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enable_logical_replication: false }),
  })
  if (!createRes.ok) {
    throw new Error(`Failed to create Neon database: ${createRes.status} ${createRes.statusText}`)
  }

  log(`GET ${NEON_API}/${dbId}`)
  const dataRes = await fetch(`${NEON_API}/${dbId}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  const { connection_string } = (await dataRes.json()) as { connection_string: string }

  const claimUrl = `${NEON_CLAIM}/${dbId}`
  log(`database created, claim: ${claimUrl}`)

  const data: CachedDb = {
    directUrl: toDirect(connection_string),
    poolerUrl: toPooler(connection_string),
    claimUrl,
    createdAt: new Date().toISOString(),
  }
  saveCache(data)
  return data
}

async function getOrCreateDatabase(forceReuse: boolean): Promise<CachedDb> {
  const cached = loadCache()
  if (cached) return cached
  if (forceReuse) throw new Error('neon-temporary: no cached database found (forceReuse=true)')
  return createNeonDatabase()
}

// ── Plugin ─────────────────────────────────────────────────────────

const plugin: DatabaseAdapterPlugin & { forceReuse: boolean; lockTimeoutMs: number } = {
  apiVersion: 1,
  name: 'neon-temporary',
  schemes: ['neon-temporary'],
  dialects: ['postgres'],
  runtime: 'any',

  /** Set to true for testing — throws instead of creating a new database */
  forceReuse: false,

  /** How long to wait for the advisory lock (ms). Default 60s. */
  lockTimeoutMs: 60_000,

  async createAdapter(_devUrl: string, _context: AdapterPluginContext): Promise<DatabaseAdapter> {
    const { directUrl } = await getOrCreateDatabase(plugin.forceReuse)

    const maskedUrl = new URL(directUrl)
    maskedUrl.password = '***'
    log(`connecting to ${maskedUrl.href}`)
    const client = new Client(directUrl)
    await client.connect()

    const adapter: DatabaseAdapter = {
      async query(sql: string, args?: unknown[]): Promise<QueryResult> {
        const result = await client.query({ text: sql, values: args, rowMode: 'array' })
        return {
          columns: result.fields.map((f) => f.name),
          rows: (result.rows as unknown[][]).map((row) => row.map((v) => normalizeValue(v))),
        }
      },
      async exec(sql: string): Promise<ExecResult> {
        const result = await client.query(sql)
        return { rowsAffected: result.rowCount ?? 0 }
      },
      async close(): Promise<void> {
        log('releasing lock...')
        try {
          await client.query(`SELECT pg_advisory_unlock(${LOCK_KEY})`)
        } catch {
          // Connection may already be closed — lock releases with session
        }
        await client.end()
        log('closed')
      },
    }

    log('acquiring advisory lock...')
    await adapter.exec(`SET lock_timeout = '${plugin.lockTimeoutMs}ms'`)
    await adapter.exec(`SELECT pg_advisory_lock(${LOCK_KEY})`)
    log('lock acquired, wiping schemas...')

    // Drop ALL user schemas — previous runs may have created extras (e.g. kitchen-sink creates a, b, c, d)
    const schemas = await adapter.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')",
    )
    for (const row of schemas.rows) {
      const name = row[0] as string
      await adapter.exec(`DROP SCHEMA "${name}" CASCADE`)
    }
    await adapter.exec('CREATE SCHEMA public')
    log('ready')

    return adapter
  },
}

export default plugin
