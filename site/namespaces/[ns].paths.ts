/**
 * Dynamic route paths loader -- generates one documentation page per namespace plugin.
 * Reads plugin metadata via extractAllPlugins() and example SQL files from disk.
 */

import fs from 'node:fs'
import path from 'node:path'
import { extractAllPlugins, type PluginMeta, type TagMeta } from '../data/extract-plugins.ts'

const examplesDir = path.resolve(import.meta.dirname!, 'examples')

// -- Helpers --

function readExample(name: string): string | undefined {
  const filePath = path.join(examplesDir, name)
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8').trim()
  }
  return undefined
}

function generateDialectBadges(databases: string[]): string {
  const badges: string[] = []
  if (databases.includes('postgres')) {
    badges.push('<DialectBadge dialect="postgres" />')
  }
  if (databases.includes('mysql')) {
    badges.push('<DialectBadge dialect="mysql" />')
  }
  if (databases.includes('sqlite')) {
    badges.push('<DialectBadge dialect="sqlite" />')
  }
  return badges.join(' ')
}

function generateArgsTable(args: TagMeta['args']): string {
  if (args === 'none') {
    return 'No arguments.'
  }

  // Check if positional (auto-generated arg names like arg0, arg1)
  const isPositional = args.every((a) => /^arg\d+$/.test(a.name))
  if (isPositional) {
    const types = args.map((a) => `\`${a.type}\``).join(', ')
    return `**Positional:** ${types}`
  }

  // Named args table
  const rows = args.map((a) => {
    const values = a.values?.join(', ') || '\u2014'
    const required = a.required ? 'Yes' : 'No'
    return `| ${a.name} | \`${a.type}\` | ${required} | ${values} |`
  })

  return [
    '| Name | Type | Required | Values |',
    '|------|------|----------|--------|',
    ...rows,
  ].join('\n')
}

function generateTagSection(plugin: PluginMeta): string {
  if (plugin.tags.length === 0) return ''

  const sections: string[] = ['## Tags', '']

  for (const tag of plugin.tags) {
    // Display $self as @pluginName (standalone form)
    const displayName = tag.name === '$self'
      ? `\`@${plugin.name}\``
      : `\`@${plugin.name}.${tag.name}\``

    sections.push(`### ${displayName}`)
    sections.push('')
    if (tag.description) {
      sections.push(tag.description)
      sections.push('')
    }
    if (tag.targets.length > 0) {
      sections.push(`**Targets:** ${tag.targets.join(', ')}`)
      sections.push('')
    }
    sections.push('**Arguments:**')
    sections.push(generateArgsTable(tag.args))
    sections.push('')
  }

  return sections.join('\n')
}

function generateLintSection(plugin: PluginMeta): string {
  if (plugin.lintRules.length === 0) return ''

  const sections: string[] = ['## Lint Rules', '']

  for (const rule of plugin.lintRules) {
    sections.push(`### \`${rule.name}\``)
    sections.push('')
    sections.push(rule.description)
    sections.push('')
    sections.push(`**Default severity:** \`${rule.default}\``)
    sections.push('')
  }

  return sections.join('\n')
}

function generateExampleSection(plugin: PluginMeta): string {
  const inputSql = readExample(`${plugin.dirName}-input.sql`)
  const outputSql = readExample(`${plugin.dirName}-output.sql`)

  if (!inputSql) return ''

  const sections: string[] = ['## Example', '']

  if (outputSql) {
    // Both input and output -- use SqlTransform component
    sections.push('<SqlTransform>')
    sections.push('<template #input>')
    sections.push('')
    sections.push('```sql')
    sections.push(inputSql)
    sections.push('```')
    sections.push('')
    sections.push('</template>')
    sections.push('<template #output>')
    sections.push('')
    sections.push('```sql')
    sections.push(outputSql)
    sections.push('```')
    sections.push('')
    sections.push('</template>')
    sections.push('</SqlTransform>')
  } else {
    // Input only (codegen, lint, docs -- output is not SQL)
    sections.push('```sql')
    sections.push(inputSql)
    sections.push('```')
  }

  sections.push('')
  return sections.join('\n')
}

function generateDocsNote(plugin: PluginMeta): string {
  if (plugin.name !== 'docs') return ''

  return `::: tip
The @docs namespace generates HTML documentation and Mermaid ER diagrams rather than SQL output. Run \`sqldoc codegen\` to see the rendered results.
:::

`
}

function generateNamespaceDoc(plugin: PluginMeta): string {
  const parts: string[] = []

  // Title and description
  parts.push(`# @${plugin.name}`)
  parts.push('')
  if (plugin.description) {
    parts.push(plugin.description)
    parts.push('')
  }

  // Dialect badges
  parts.push(generateDialectBadges(plugin.databases))
  parts.push('')

  // Special note for @docs
  parts.push(generateDocsNote(plugin))

  // Example section
  parts.push(generateExampleSection(plugin))

  // Tags section
  parts.push(generateTagSection(plugin))

  // Lint rules section
  parts.push(generateLintSection(plugin))

  return parts.join('\n')
}

// -- Export --

export default {
  paths() {
    const plugins = extractAllPlugins()
    return plugins.map((plugin) => ({
      params: { ns: plugin.dirName },
      content: generateNamespaceDoc(plugin),
    }))
  },
}
