/**
 * Dynamic route loader for template detail pages.
 * Generates one page per code generation template with usage examples
 * and configuration tables where applicable.
 */

import { extractAllTemplates, type TemplateMeta } from '../data/extract-templates.ts'

export default {
  async paths() {
    const templates = await extractAllTemplates()
    return templates.map(tpl => ({
      params: { tpl: tpl.slug },
      content: generateTemplatePage(tpl),
    }))
  },
}

function generateTemplatePage(tpl: TemplateMeta): string {
  const lines: string[] = []

  // Title
  lines.push(`# ${tpl.name}`)
  lines.push('')

  // Language badge
  lines.push(`<span class="template-lang-badge">${tpl.language}</span>`)
  lines.push('')

  // Description
  lines.push(tpl.description)
  lines.push('')

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
