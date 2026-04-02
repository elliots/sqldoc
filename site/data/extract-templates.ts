/**
 * Template metadata extraction -- reads each template's index.ts as plain text
 * and extracts the defineTemplate() properties. No dynamic imports needed,
 * so this works on Cloudflare Pages without monorepo dependencies.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// -- Types --

export interface TemplateMeta {
  name: string
  slug: string
  description: string
  language: string
  hasConfigSchema: boolean
  configSchema?: Record<string, any>
  sourceFile: string
}

// -- Directories to exclude (not templates) --

const EXCLUDED_DIRS = new Set(['__tests__', 'helpers', 'types', 'tags', 'typeorm'])

// -- Language sort order for consistent grouping --

const LANGUAGE_ORDER: Record<string, number> = {
  typescript: 0,
  go: 1,
  python: 2,
  java: 3,
  kotlin: 4,
  rust: 5,
  csharp: 6,
  json: 7,
  xml: 8,
  protobuf: 9,
  cobol: 10,
  sql: 11,
}

// -- Simple property extraction from defineTemplate({ ... }) --

function extractStringProp(source: string, prop: string): string | null {
  // Match: prop: 'value' or prop: "value" — only before generate(
  const genIdx = source.indexOf('generate(')
  const area = genIdx !== -1 ? source.slice(0, genIdx) : source.slice(0, 1000)
  const match = area.match(new RegExp(`${prop}:\\s*['"]([^'"]+)['"]`))
  return match ? match[1] : null
}

// -- Extraction --

export function extractAllTemplates(): TemplateMeta[] {
  const templatesDir = path.resolve(import.meta.dirname!, '../../packages/templates/src')
  const entries = fs.readdirSync(templatesDir, { withFileTypes: true })
  const templates: TemplateMeta[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (EXCLUDED_DIRS.has(entry.name)) continue

    const indexPath = path.join(templatesDir, entry.name, 'index.ts')
    if (!fs.existsSync(indexPath)) continue

    const source = fs.readFileSync(indexPath, 'utf-8')
    if (!source.includes('defineTemplate')) continue

    const name = extractStringProp(source, 'name') ?? entry.name
    const description = extractStringProp(source, 'description') ?? ''
    const language = extractStringProp(source, 'language') ?? 'unknown'
    const hasConfigSchema = /export\s+const\s+configSchema\s*=/.test(source)

    templates.push({
      name,
      slug: entry.name,
      description,
      language,
      hasConfigSchema,
      sourceFile: indexPath,
    })
  }

  // Sort by language grouping, then by name within same language
  templates.sort((a, b) => {
    const aOrder = LANGUAGE_ORDER[a.language] ?? 99
    const bOrder = LANGUAGE_ORDER[b.language] ?? 99
    if (aOrder !== bOrder) return aOrder - bOrder
    return a.name.localeCompare(b.name)
  })

  return templates
}
