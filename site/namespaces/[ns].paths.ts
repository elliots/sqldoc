/**
 * Dynamic route paths loader -- generates one documentation page per namespace plugin.
 * Reads namespace metadata directly from the runtime plugin objects.
 */

import { extractAllPlugins, type PluginMeta, type TagMeta } from '../data/extract-plugins.ts'

function generateDialectBadges(databases: string[]): string {
  const badges: string[] = []
  if (databases.includes('postgres')) badges.push('<DialectBadge dialect="postgres" />')
  if (databases.includes('mysql')) badges.push('<DialectBadge dialect="mysql" />')
  if (databases.includes('sqlite')) badges.push('<DialectBadge dialect="sqlite" />')
  if (databases.includes('mssql')) badges.push('<DialectBadge dialect="mssql" />')
  return badges.join(' ')
}

function generateArgsTable(args: TagMeta['args']): string {
  if (args === 'none') return 'No arguments.'

  const isPositional = args.every((arg) => /^arg\d+$/.test(arg.name))
  if (isPositional) {
    const types = args.map((arg) => `\`${arg.type}\``).join(', ')
    return `**Positional:** ${types}`
  }

  const rows = args.map((arg) => {
    const values = arg.values?.join(', ') || '\u2014'
    const required = arg.required ? 'Yes' : 'No'
    return `| ${arg.name} | \`${arg.type}\` | ${required} | ${values} |`
  })

  return ['| Name | Type | Required | Values |', '|------|------|----------|--------|', ...rows].join('\n')
}

function generateTagSection(plugin: PluginMeta): string {
  if (plugin.tags.length === 0) return ''

  const sections: string[] = ['## Tags', '']
  for (const tag of plugin.tags) {
    const displayName = tag.name === '$self' ? `\`@${plugin.name}\`` : `\`@${plugin.name}.${tag.name}\``
    sections.push(`### ${displayName}`, '')
    if (tag.description) sections.push(tag.description, '')
    if (tag.targets.length > 0) sections.push(`**Targets:** ${tag.targets.join(', ')}`, '')
    sections.push('**Arguments:**', generateArgsTable(tag.args), '')
  }

  return sections.join('\n')
}

function generateLintSection(plugin: PluginMeta): string {
  if (plugin.lintRules.length === 0) return ''

  const sections: string[] = ['## Lint Rules', '']
  for (const rule of plugin.lintRules) {
    sections.push(`### \`${rule.name}\``, '', rule.description, '', `**Default severity:** \`${rule.default}\``, '')
  }
  return sections.join('\n')
}

function renderSqlTransform(input: string, output: string): string[] {
  return [
    '<SqlTransform>',
    '<template #input>',
    '',
    '```sql',
    input,
    '```',
    '',
    '</template>',
    '<template #output>',
    '',
    '```sql',
    output,
    '```',
    '',
    '</template>',
    '</SqlTransform>',
  ]
}

function generateExampleSection(plugin: PluginMeta): string {
  if (plugin.examples.length === 0) return ''

  const sections: string[] = [plugin.examples.length > 1 ? '## Examples' : '## Example', '']
  for (const [index, example] of plugin.examples.entries()) {
    if (plugin.examples.length > 1 || example.title) {
      sections.push(`### ${example.title}`, '')
    }
    if (example.description) {
      sections.push(example.description, '')
    }

    if (example.output) {
      sections.push(...renderSqlTransform(example.input, example.output))
    } else {
      sections.push('```sql', example.input, '```')
    }

    if (index < plugin.examples.length - 1) sections.push('')
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
  parts.push(`<div class="doc-title"><h1>@${plugin.name}</h1></div>`, '')
  if (plugin.description) parts.push(plugin.description, '')
  parts.push(generateDialectBadges(plugin.databases), '')
  parts.push(generateDocsNote(plugin))
  parts.push(generateExampleSection(plugin))
  parts.push(generateTagSection(plugin))
  parts.push(generateLintSection(plugin))
  return parts.join('\n')
}

export default {
  paths() {
    const plugins = extractAllPlugins()
    return plugins.map((plugin) => ({
      params: { ns: plugin.dirName },
      frontmatter: {
        title: `@${plugin.name}`,
        outline: 'deep',
      },
      content: generateNamespaceDoc(plugin),
    }))
  },
}
