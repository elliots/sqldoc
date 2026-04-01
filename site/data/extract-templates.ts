/**
 * Template metadata extraction -- dynamically imports each template's index.ts
 * via Bun's native TS support and reads the defineTemplate() export directly.
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

const EXCLUDED_DIRS = new Set(['__tests__', 'helpers', 'types', 'tags'])

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

// -- Extraction --

export async function extractAllTemplates(): Promise<TemplateMeta[]> {
  const templatesDir = path.resolve(import.meta.dirname!, '../../packages/templates/src')
  const entries = fs.readdirSync(templatesDir, { withFileTypes: true })
  const templates: TemplateMeta[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (EXCLUDED_DIRS.has(entry.name)) continue

    const indexPath = path.join(templatesDir, entry.name, 'index.ts')
    if (!fs.existsSync(indexPath)) continue

    try {
      const mod = await import(indexPath)
      const tpl = mod.default

      if (!tpl || typeof tpl !== 'function') continue

      templates.push({
        name: tpl.name ?? entry.name,
        slug: entry.name,
        description: tpl.description ?? '',
        language: tpl.language ?? 'unknown',
        hasConfigSchema: tpl.configSchema != null,
        configSchema: tpl.configSchema,
        sourceFile: indexPath,
      })
    } catch {
      // Skip templates that fail to import (e.g. missing dependencies)
      continue
    }
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
