/**
 * Dynamic route loader for template detail pages.
 * Generates one page per code generation template with usage examples,
 * configuration tables, and pet-store example output.
 */

import fs from 'node:fs'
import path from 'node:path'
import { extractAllTemplates, type TemplateMeta } from '../data/extract-templates.ts'

const generatedDir = path.resolve(import.meta.dirname!, '../../tests/pet-store-postgres/generated')

interface GeneratedFile {
  name: string
  content: string
}

function readGeneratedOutput(slug: string): GeneratedFile[] {
  const dir = path.join(generatedDir, slug)
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.')).sort()
  return files.map(f => ({
    name: f,
    content: fs.readFileSync(path.join(dir, f), 'utf-8'),
  }))
}

// Devicon class for the template — prefer package-specific icon, fall back to language
const DEVICON_MAP: Record<string, string> = {
  // Package-specific icons
  prisma: 'devicon-prisma-plain',
  knex: 'devicon-knexjs-plain',
  sqlalchemy: 'devicon-sqlalchemy-plain',
  jpa: 'devicon-hibernate-plain',
  hibernate: 'devicon-hibernate-plain',
  // Language icons (fallback)
  typescript: 'devicon-typescript-plain',
  go: 'devicon-go-plain',
  python: 'devicon-python-plain',
  java: 'devicon-java-plain',
  kotlin: 'devicon-kotlin-plain',
  rust: 'devicon-rust-original',
  csharp: 'devicon-csharp-plain',
  json: 'devicon-json-plain',
  xml: 'devicon-xml-plain',
  cobol: 'devicon-cobol-plain',
}

function getDeviconClass(tpl: TemplateMeta): string | null {
  return DEVICON_MAP[tpl.slug] ?? DEVICON_MAP[tpl.language] ?? null
}

function langForCodeBlock(tpl: TemplateMeta): string {
  const map: Record<string, string> = {
    typescript: 'typescript',
    go: 'go',
    python: 'python',
    java: 'java',
    kotlin: 'kotlin',
    rust: 'rust',
    csharp: 'csharp',
    json: 'json',
    xml: 'xml',
    protobuf: 'protobuf',
    cobol: 'cobol',
    sql: 'sql',
  }
  return map[tpl.language] ?? 'text'
}

export default {
  async paths() {
    const templates = await extractAllTemplates()
    return templates.map(tpl => ({
      params: {
        tpl: tpl.slug,
      },
      frontmatter: {
        title: tpl.name,
        outline: 'deep',
      },
      content: generateTemplatePage(tpl),
    }))
  },
}

function generateTemplatePage(tpl: TemplateMeta): string {
  const lines: string[] = []

  // Title with icon
  const icon = getDeviconClass(tpl)
  const iconHtml = icon ? `<i class="${icon} template-title-icon"></i> ` : ''
  lines.push(`<h1>${iconHtml}${tpl.name}</h1>`)
  lines.push('')

  // Language badge
  lines.push(`<span class="template-lang-badge">${tpl.language}</span>`)
  lines.push('')

  // Description
  lines.push(tpl.description)
  lines.push('')

  // Example output section
  const outputs = readGeneratedOutput(tpl.slug)
  if (outputs.length > 0) {
    const lang = langForCodeBlock(tpl)
    lines.push('## Example Output')
    lines.push('')
    lines.push(`Generated from the [pet-store](/guide/quick-start) sample schema:`)
    lines.push('')

    for (const file of outputs) {
      if (outputs.length > 1) {
        lines.push(`#### \`${file.name}\``)
        lines.push('')
      }
      lines.push(`\`\`\`${lang}`)
      lines.push(file.content.trim())
      lines.push('```')
      lines.push('')
    }
  }

  // Usage section
  lines.push('## Usage')
  lines.push('')
  lines.push('Add to your `sqldoc.config.ts`:')
  lines.push('')
  lines.push('```typescript')
  lines.push('export default {')
  lines.push("  dialect: 'postgres',")
  lines.push("  schema: ['./schema.sql'],")
  lines.push('  codegen: [')
  lines.push('    {')
  lines.push(`      template: '${tpl.slug}',`)
  lines.push(`      output: './generated/${getDefaultOutputFilename(tpl)}',`)
  if (tpl.hasConfigSchema) {
    lines.push('      config: {')
    lines.push('        // See configuration options below')
    lines.push('      },')
  }
  lines.push('    },')
  lines.push('  ],')
  lines.push('}')
  lines.push('```')
  lines.push('')

  lines.push('Then run:')
  lines.push('')
  lines.push('```bash')
  lines.push('sqldoc codegen')
  lines.push('```')
  lines.push('')

  // Configuration section (if configSchema exists)
  if (tpl.hasConfigSchema && tpl.configSchema) {
    lines.push('## Configuration')
    lines.push('')
    lines.push('| Option | Type | Values | Description |')
    lines.push('|--------|------|--------|-------------|')

    for (const [key, schema] of Object.entries(tpl.configSchema)) {
      const s = schema as any
      const type = s.type || 'string'
      const values = s.values ? s.values.join(', ') : '\u2014'
      const desc = s.description || '\u2014'
      lines.push(`| \`${key}\` | ${type} | ${values} | ${desc} |`)
    }
    lines.push('')
  }

  // Style for lang badge
  lines.push('<style>')
  lines.push('.template-title-icon {')
  lines.push('  font-size: 0.85em;')
  lines.push('  vertical-align: baseline;')
  lines.push('  margin-right: 4px;')
  lines.push('  color: var(--vp-c-brand-1);')
  lines.push('}')
  lines.push('.template-lang-badge {')
  lines.push('  display: inline-block;')
  lines.push('  font-size: 12px;')
  lines.push('  font-weight: 600;')
  lines.push('  text-transform: uppercase;')
  lines.push('  letter-spacing: 0.05em;')
  lines.push('  padding: 2px 8px;')
  lines.push('  border-radius: 4px;')
  lines.push('  background: var(--vp-c-brand-soft);')
  lines.push('  color: var(--vp-c-brand-1);')
  lines.push('  margin-bottom: 16px;')
  lines.push('}')
  lines.push('</style>')

  return lines.join('\n')
}

function getDefaultOutputFilename(tpl: TemplateMeta): string {
  const ext: Record<string, string> = {
    typescript: 'types.ts',
    go: 'models.go',
    python: 'models.py',
    java: 'Models.java',
    kotlin: 'Models.kt',
    rust: 'models.rs',
    csharp: 'Models.cs',
    json: 'schema.json',
    xml: 'schema.xsd',
    protobuf: 'schema.proto',
    sql: 'schema.prisma',
    cobol: 'COPYBOOK.cpy',
  }
  return ext[tpl.language] || 'output'
}
