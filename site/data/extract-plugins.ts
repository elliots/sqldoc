/**
 * Plugin metadata extraction -- reads ns-* packages and extracts structured data
 * for the documentation site. Uses only Node.js built-in APIs (no @sqldoc/* imports).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// -- Types --

export interface ArgMeta {
  name: string
  type: string
  required?: boolean
  values?: string[]
}

export interface TagMeta {
  name: string
  description: string
  targets: string[]
  args: ArgMeta[] | 'none'
}

export interface LintRuleMeta {
  name: string
  description: string
  default: string
}

export interface PluginMeta {
  name: string
  dirName: string
  description: string
  databases: string[]
  tags: TagMeta[]
  lintRules: LintRuleMeta[]
  sourceFile: string
}

// -- Extraction helpers --

/** Find the matching closing brace for a block starting at the given offset. */
function findClosingBrace(source: string, startIndex: number): number {
  let depth = 0
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Extract individual tag blocks from the tags object source (top-level keys only). */
function extractTagBlocks(tagsSource: string): Array<{ key: string; body: string }> {
  const results: Array<{ key: string; body: string }> = []

  // Walk through source tracking depth to only match top-level tag keys
  let depth = 0
  let i = 0
  while (i < tagsSource.length) {
    if (depth === 0) {
      // At top level -- look for a tag key pattern: 'key': { or key: {
      const remaining = tagsSource.slice(i)

      // Match quoted key ('$self', 'omit.operations') or bare identifier (emit, check, etc.)
      const keyMatch = remaining.match(/^(?:'([^']+)'|"([^"]+)"|([\w$][\w.]*)):\s*\{/)
      if (keyMatch) {
        const key = keyMatch[1] || keyMatch[2] || keyMatch[3]
        const braceStart = i + keyMatch[0].length - 1
        const braceEnd = findClosingBrace(tagsSource, braceStart)
        if (braceEnd !== -1) {
          const body = tagsSource.slice(braceStart + 1, braceEnd)
          results.push({ key, body })
          i = braceEnd + 1
          continue
        }
      }
    }

    // Track brace depth for skipping
    if (tagsSource[i] === '{') depth++
    else if (tagsSource[i] === '}') depth--

    i++
  }

  return results
}

/** Parse a single tag body to extract description, targets, and args. */
function parseTagBody(body: string): { description: string; targets: string[]; args: ArgMeta[] | 'none' } {
  // Extract description
  const descMatch = body.match(/description:\s*'([^']*)'/)
  const description = descMatch ? descMatch[1] : ''

  // Extract targets array
  const targetsMatch = body.match(/targets:\s*\[([^\]]*)\]/)
  const targets = targetsMatch
    ? targetsMatch[1].match(/'([^']+)'/g)?.map((s) => s.replace(/'/g, '')) ?? []
    : []

  // Check for args
  // First check if args is an array (positional args): args: [{ ... }]
  const positionalArgsMatch = body.match(/args:\s*\[/)
  if (positionalArgsMatch) {
    const argsStart = body.indexOf('[', positionalArgsMatch.index!)
    // Find matching bracket
    let depth = 0
    let argsEnd = argsStart
    for (let i = argsStart; i < body.length; i++) {
      if (body[i] === '[') depth++
      else if (body[i] === ']') {
        depth--
        if (depth === 0) {
          argsEnd = i
          break
        }
      }
    }
    const argsSource = body.slice(argsStart, argsEnd + 1)

    // Extract positional args: [{ type: 'string' }, { type: 'string' }]
    const positionalArgs: ArgMeta[] = []
    const argItemPattern = /\{\s*type:\s*'([^']+)'/g
    let argMatch: RegExpExecArray | null
    let idx = 0
    while ((argMatch = argItemPattern.exec(argsSource)) !== null) {
      positionalArgs.push({
        name: `arg${idx}`,
        type: argMatch[1],
      })
      idx++
    }
    return { description, targets, args: positionalArgs.length > 0 ? positionalArgs : 'none' }
  }

  // Check for named args: args: { key: { type: '...', ... }, ... }
  const namedArgsMatch = body.match(/args:\s*\{/)
  if (namedArgsMatch) {
    const argsStart = body.indexOf('{', namedArgsMatch.index!)
    const argsEnd = findClosingBrace(body, argsStart)
    if (argsEnd === -1) return { description, targets, args: 'none' }

    const argsSource = body.slice(argsStart + 1, argsEnd)
    const namedArgs: ArgMeta[] = []

    // Match named arg entries: key: { type: '...', ... }
    const namedArgPattern = /(\w+):\s*\{([^}]*)\}/g
    let namedMatch: RegExpExecArray | null
    while ((namedMatch = namedArgPattern.exec(argsSource)) !== null) {
      const argName = namedMatch[1]
      // Skip non-arg properties (like 'items' inside an arg)
      if (argName === 'items') continue

      const argBody = namedMatch[2]
      const typeMatch = argBody.match(/type:\s*'([^']+)'/)
      const requiredMatch = argBody.match(/required:\s*(true|false)/)
      const valuesMatch = argBody.match(/values:\s*\[([^\]]*)\]/)

      const arg: ArgMeta = {
        name: argName,
        type: typeMatch ? typeMatch[1] : 'string',
      }

      if (requiredMatch) {
        arg.required = requiredMatch[1] === 'true'
      }

      if (valuesMatch) {
        arg.values = valuesMatch[1].match(/'([^']+)'/g)?.map((s) => s.replace(/'/g, '')) ?? []
      }

      namedArgs.push(arg)
    }

    return { description, targets, args: namedArgs.length > 0 ? namedArgs : 'none' }
  }

  return { description, targets, args: 'none' }
}

/** Extract lint rules from plugin source. */
function extractLintRules(source: string): LintRuleMeta[] {
  const rules: LintRuleMeta[] = []
  const lintRulesMatch = source.match(/lintRules:\s*\[/)
  if (!lintRulesMatch) return rules

  // Find the lintRules array
  const arrayStart = source.indexOf('[', lintRulesMatch.index!)
  let depth = 0
  let arrayEnd = arrayStart
  for (let i = arrayStart; i < source.length; i++) {
    if (source[i] === '[') depth++
    else if (source[i] === ']') {
      depth--
      if (depth === 0) {
        arrayEnd = i
        break
      }
    }
  }
  const arraySource = source.slice(arrayStart, arrayEnd + 1)

  // Extract individual rule objects
  const namePattern = /name:\s*'([^']+)'/g
  const descPattern = /description:\s*'([^']+)'/g
  const defaultPattern = /default:\s*'([^']+)'/g

  const names: string[] = []
  const descriptions: string[] = []
  const defaults: string[] = []

  let m: RegExpExecArray | null
  while ((m = namePattern.exec(arraySource)) !== null) names.push(m[1])
  while ((m = descPattern.exec(arraySource)) !== null) descriptions.push(m[1])
  while ((m = defaultPattern.exec(arraySource)) !== null) defaults.push(m[1])

  for (let i = 0; i < names.length; i++) {
    rules.push({
      name: names[i],
      description: descriptions[i] || '',
      default: defaults[i] || 'off',
    })
  }

  return rules
}

/** Extract plugin description: first try plugin-level description property, then JSDoc fallback. */
function extractDescription(source: string): string {
  // Look for description property at the plugin object level (not inside tags)
  // The plugin description is between the plugin object start and the tags: { block
  const pluginStart = source.search(/const\s+plugin.*=\s*\{/)
  if (pluginStart !== -1) {
    const tagsStart = source.indexOf('tags:', pluginStart)
    const pluginSection = tagsStart !== -1 ? source.slice(pluginStart, tagsStart) : source.slice(pluginStart, pluginStart + 500)

    const descMatch = pluginSection.match(/description:\s*'([^']*)'/)
    if (descMatch) return descMatch[1]
  }

  // Fallback: first JSDoc comment
  const jsdocMatch = source.match(/^\/\*\*\s*\n([\s\S]*?)\s*\*\//)
  if (jsdocMatch) {
    const lines = jsdocMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0 && !l.startsWith('@'))
    return lines.join(' ')
  }

  return ''
}

// -- Main extraction --

export function extractPluginMetadata(source: string, filePath: string): PluginMeta {
  // Extract name
  const nameMatch = source.match(/name:\s*'([^']+)'/)
  const name = nameMatch ? nameMatch[1] : path.basename(path.dirname(path.dirname(filePath)))

  // Extract directory name (strip ns- prefix)
  const dirName = path.basename(path.dirname(path.dirname(filePath))).replace(/^ns-/, '')

  // Extract description
  const description = extractDescription(source)

  // Extract databases
  const dbMatch = source.match(/databases:\s*\[([^\]]*)\]/)
  const databases = dbMatch
    ? dbMatch[1].match(/'([^']+)'/g)?.map((s) => s.replace(/'/g, '')) ?? ['postgres', 'mysql', 'sqlite']
    : ['postgres', 'mysql', 'sqlite']

  // Extract tags object
  const tags: TagMeta[] = []
  const tagsBlockMatch = source.match(/tags:\s*\{/)
  if (tagsBlockMatch) {
    const tagsStart = source.indexOf('{', tagsBlockMatch.index!)
    const tagsEnd = findClosingBrace(source, tagsStart)
    if (tagsEnd !== -1) {
      const tagsSource = source.slice(tagsStart + 1, tagsEnd)
      const tagBlocks = extractTagBlocks(tagsSource)

      for (const block of tagBlocks) {
        const parsed = parseTagBody(block.body)
        tags.push({
          name: block.key,
          description: parsed.description,
          targets: parsed.targets,
          args: parsed.args,
        })
      }
    }
  }

  // Extract lint rules
  const lintRules = extractLintRules(source)

  return {
    name,
    dirName,
    description,
    databases,
    tags,
    lintRules,
    sourceFile: filePath,
  }
}

export function extractAllPlugins(): PluginMeta[] {
  const packagesDir = path.resolve(import.meta.dirname!, '../../packages')
  const entries = fs.readdirSync(packagesDir, { withFileTypes: true })
  const plugins: PluginMeta[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('ns-')) continue
    const indexPath = path.join(packagesDir, entry.name, 'src', 'index.ts')
    if (!fs.existsSync(indexPath)) continue

    const source = fs.readFileSync(indexPath, 'utf-8')
    const meta = extractPluginMetadata(source, indexPath)
    plugins.push(meta)
  }

  // Sort alphabetically by name
  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return plugins
}
