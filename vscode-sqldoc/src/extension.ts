import * as path from 'node:path'
import {
  type ArgType,
  detectTarget,
  loadImports,
  parse,
  SqlparserTsAdapter,
  type SqlStatement,
  type SqlTarget,
  setImportLogger,
  type TagDef,
  type TagNamespace,
  validate,
} from '@sqldoc/core'
import * as vscode from 'vscode'

const DIAGNOSTIC_SOURCE = 'sqldoc'
const SQL_SELECTORS = ['sql', 'pgsql', 'plpgsql', 'postgres']

let diagnosticCollection: vscode.DiagnosticCollection
let astAdapter: SqlparserTsAdapter | null = null
let outputChannel: vscode.OutputChannel

// Cache loaded namespaces per document URI so completions can use them
const nsCache = new Map<string, Map<string, TagNamespace>>()

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('sqldoc')
  context.subscriptions.push(outputChannel)
  outputChannel.appendLine('sqldoc extension activated')
  setImportLogger((msg) => outputChannel.appendLine(msg))

  diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE)
  context.subscriptions.push(diagnosticCollection)

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => maybeValidate(doc)),
    vscode.workspace.onDidSaveTextDocument((doc) => maybeValidate(doc)),
    vscode.workspace.onDidChangeTextDocument((e) => maybeValidate(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnosticCollection.delete(doc.uri)
      nsCache.delete(doc.uri.toString())
    }),
  )

  // Register completion + hover providers for all SQL language IDs
  for (const lang of SQL_SELECTORS) {
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(
        { language: lang },
        new SqlTagCompletionProvider(),
        '@',
        '.',
        '(',
        ',',
        ':',
        '[',
        ' ',
      ),
      vscode.languages.registerHoverProvider({ language: lang }, new SqlTagHoverProvider()),
    )
  }

  // DocumentLinkProvider for ctrl+click on @import paths
  const importLinkProvider = new ImportDocumentLinkProvider()
  for (const lang of SQL_SELECTORS) {
    context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: lang }, importLinkProvider))
  }

  // Clear stale diagnostics from previous extension version, then re-validate
  diagnosticCollection.clear()
  for (const doc of vscode.workspace.textDocuments) maybeValidate(doc)
}

export function deactivate() {
  diagnosticCollection?.dispose()
}

function maybeValidate(doc: vscode.TextDocument) {
  if (!SQL_SELECTORS.includes(doc.languageId)) return
  validateDocument(doc)
}

async function validateDocument(doc: vscode.TextDocument) {
  const text = doc.getText()
  const parsed = parse(text)
  const vscodeDiags: vscode.Diagnostic[] = []

  const importPaths = parsed.imports.map((i) => i.path)
  const { namespaces, errors: importErrors } = await loadImports(importPaths, doc.uri.fsPath)

  // Update cache
  nsCache.set(doc.uri.toString(), namespaces)

  for (const err of importErrors) {
    const imp = parsed.imports.find((i) => i.path === err.importPath)
    if (imp) {
      vscodeDiags.push(
        new vscode.Diagnostic(
          new vscode.Range(imp.line, imp.startCol, imp.line, imp.endCol),
          `Failed to import '${err.importPath}': ${err.message}`,
          vscode.DiagnosticSeverity.Error,
        ),
      )
    }
  }

  // Parse SQL AST for column type info
  let statements: SqlStatement[] = []
  let initFailed = false
  try {
    if (!astAdapter) {
      // TODO: read dialect from workspace sqldoc.config.ts
      astAdapter = new SqlparserTsAdapter()
      await astAdapter.init()
    }
    statements = astAdapter.parseStatements(text)
  } catch (err: any) {
    // If init failed, reset so we retry next time
    if (!astAdapter || !(astAdapter as any).initialized) {
      astAdapter = null
      initFailed = true
    }
    vscodeDiags.push(
      new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        `SQL parsing failed: ${err?.message ?? 'unknown error'}`,
        vscode.DiagnosticSeverity.Warning,
      ),
    )
  }

  // If AST init failed entirely, skip tag validation — we can't resolve blocks
  if (initFailed) {
    for (const d of vscodeDiags) d.source = DIAGNOSTIC_SOURCE
    diagnosticCollection.set(doc.uri, vscodeDiags)
    return
  }

  const tagDiags = validate(parsed.tags, namespaces, text, statements)
  for (const d of tagDiags) {
    vscodeDiags.push(
      new vscode.Diagnostic(
        new vscode.Range(d.line, d.startCol, d.line, d.endCol),
        d.message,
        d.severity === 'error'
          ? vscode.DiagnosticSeverity.Error
          : d.severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information,
      ),
    )
  }

  for (const d of vscodeDiags) {
    d.source = DIAGNOSTIC_SOURCE
  }
  diagnosticCollection.set(doc.uri, vscodeDiags)
}

// ── Target detection for current cursor position ─────────────────────

function detectTargetAtLine(doc: vscode.TextDocument, lineNum: number): SqlTarget {
  // Scan forward to collect the SQL lines this comment block is attached to
  const sqlLines: string[] = []
  for (let i = lineNum + 1; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text
    const trimmed = text.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('--')) continue
    sqlLines.push(text)
    if (trimmed.endsWith(';') || trimmed.endsWith(',') || trimmed.endsWith(');') || trimmed === ')') break
  }
  if (sqlLines.length === 0) {
    return 'unknown'
  }
  return detectTarget(sqlLines)
}

// ── Completion provider ───────────────────────────────────────────────

class SqlTagCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] | undefined {
    const line = doc.lineAt(pos.line).text
    const before = line.substring(0, pos.character)

    // Only complete inside SQL comments
    if (!/--/.test(before)) return undefined

    const namespaces = nsCache.get(doc.uri.toString())
    if (!namespaces || namespaces.size === 0) return undefined

    // Detect what SQL target we're on by looking at lines below
    const target = detectTargetAtLine(doc, pos.line)

    // 1. After "@" — suggest namespace names (filtered by target)
    const nsMatch = before.match(/@(\w*)$/)
    if (nsMatch) {
      return this.completeNamespaces(namespaces, nsMatch[1], target)
    }

    // 2. After "@namespace." — suggest tag names (filtered by target)
    const tagMatch = before.match(/@(\w+)\.(\w*)$/)
    if (tagMatch) {
      return this.completeTags(namespaces, tagMatch[1], tagMatch[2], target)
    }

    // 3. Inside args — find the enclosing tag and figure out what to suggest
    return this.completeArgs(before, namespaces)
  }

  private completeNamespaces(
    namespaces: Map<string, TagNamespace>,
    prefix: string,
    target: SqlTarget,
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = []
    for (const [name, ns] of namespaces) {
      if (!name.startsWith(prefix)) continue

      // Filter: only suggest this namespace if it has at least one tag valid for this target
      if (target !== 'unknown') {
        const hasValidTag = Object.entries(ns.tags).some(
          ([, def]) => !def.targets || def.targets.length === 0 || def.targets.includes(target),
        )
        if (!hasValidTag) continue
      }

      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module)
      item.detail = `@${name}`
      const tagNames = Object.keys(ns.tags).filter((t) => t !== '$self')
      if (tagNames.length) {
        item.documentation = `Tags: ${tagNames.join(', ')}`
      }
      items.push(item)
    }
    return items
  }

  private completeTags(
    namespaces: Map<string, TagNamespace>,
    nsName: string,
    prefix: string,
    target: SqlTarget,
  ): vscode.CompletionItem[] {
    const ns = namespaces.get(nsName)
    if (!ns) return []

    const items: vscode.CompletionItem[] = []
    for (const [tagName, tagDef] of Object.entries(ns.tags)) {
      if (tagName === '$self') continue
      if (!tagName.startsWith(prefix)) continue

      // Filter by target
      if (target !== 'unknown' && tagDef.targets && tagDef.targets.length > 0) {
        if (!tagDef.targets.includes(target)) continue
      }

      const item = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Property)
      item.detail = `@${nsName}.${tagName}`
      if (tagDef.description) {
        item.documentation = tagDef.description
      }
      if (tagDef.args) {
        item.insertText = new vscode.SnippetString(`${tagName}($0)`)
      }
      items.push(item)
    }
    return items
  }

  private completeArgs(before: string, namespaces: Map<string, TagNamespace>): vscode.CompletionItem[] | undefined {
    // Find the tag this arg belongs to by scanning backwards for @ns.tag(
    const tagArgMatch = before.match(/@(\w+)(?:\.(\w+))?\(([^)]*)$/)
    if (!tagArgMatch) return undefined

    const nsName = tagArgMatch[1]
    const tagName = tagArgMatch[2] || null
    const argsSoFar = tagArgMatch[3]

    const ns = namespaces.get(nsName)
    if (!ns) return undefined

    const tagDef: TagDef | undefined = tagName ? ns.tags[tagName] : ns.tags.$self
    if (!tagDef || !tagDef.args) return undefined

    if (Array.isArray(tagDef.args)) {
      // Positional args
      return this.completePositionalArgs(tagDef.args, argsSoFar)
    } else {
      // Named args
      return this.completeNamedArgs(tagDef.args, argsSoFar)
    }
  }

  private completePositionalArgs(argTypes: ArgType[], argsSoFar: string): vscode.CompletionItem[] {
    // Figure out which positional index we're at
    const parts = argsSoFar.split(',')
    const idx = parts.length - 1
    if (idx >= argTypes.length) return []

    return this.enumItemsForType(argTypes[idx])
  }

  private completeNamedArgs(
    argDefs: Record<string, ArgType & { required?: boolean }>,
    argsSoFar: string,
  ): vscode.CompletionItem[] {
    const trimmed = argsSoFar.trimStart()

    // Check if we're after "key:" or "key: [" — suggest enum values
    const valueMatch = trimmed.match(/(\w+)\s*:\s*\[?\s*(?:[^,\]]*,\s*)*(\w*)$/)
    if (valueMatch) {
      const key = valueMatch[1]
      const def = argDefs[key]
      if (def) {
        // If it's an array type, complete the items
        if (def.type === 'array') {
          return this.enumItemsForType(def.items)
        }
        return this.enumItemsForType(def)
      }
    }

    // Check if we're at a position to type a key name (after comma or at start)
    const atKeyPos = /(?:^|,\s*)(\w*)$/.test(trimmed)
    if (atKeyPos) {
      // Suggest arg keys that haven't been used yet
      const usedKeys = new Set<string>()
      const keyRe = /(\w+)\s*:/g
      let m: RegExpExecArray | null
      while ((m = keyRe.exec(argsSoFar)) !== null) {
        usedKeys.add(m[1])
      }

      const items: vscode.CompletionItem[] = []
      for (const [key, def] of Object.entries(argDefs)) {
        if (usedKeys.has(key)) continue
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Field)
        item.detail = (def as any).required ? '(required)' : '(optional)'
        item.documentation = `Type: ${formatType(def)}`
        // Insert "key: " with cursor after the space
        item.insertText = new vscode.SnippetString(`${key}: $0`)
        items.push(item)
      }
      return items
    }

    return []
  }

  private enumItemsForType(argType: ArgType): vscode.CompletionItem[] {
    if (argType.type === 'enum') {
      return argType.values.map((v) => {
        const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember)
        item.detail = 'enum value'
        return item
      })
    }
    if (argType.type === 'boolean') {
      return ['true', 'false'].map((v) => {
        return new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember)
      })
    }
    return []
  }
}

function formatType(t: ArgType): string {
  switch (t.type) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'enum':
      return (t as any).values.join(' | ')
    case 'array':
      return `[${formatType((t as any).items)}]`
    default:
      return 'unknown'
  }
}

// ── Hover provider ────────────────────────────────────────────────────

class SqlTagHoverProvider implements vscode.HoverProvider {
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const line = doc.lineAt(pos.line).text
    const col = pos.character

    // Only inside SQL comments
    const commentStart = line.indexOf('--')
    if (commentStart < 0 || col < commentStart) return undefined

    const namespaces = nsCache.get(doc.uri.toString())
    if (!namespaces || namespaces.size === 0) return undefined

    // Try matching a full tag expression: @ns.tag(args) or @ns(args) or @ns.tag or @ns
    const TAG_FULL_RE = /@(\w+)(?:\.(\w+))?(?:\(([^)]*)\))?/g
    let m: RegExpExecArray | null
    while ((m = TAG_FULL_RE.exec(line)) !== null) {
      const matchStart = m.index
      const matchEnd = matchStart + m[0].length
      if (col < matchStart || col > matchEnd) continue

      const nsName = m[1]
      const tagName = m[2] || null
      const rawArgs = m[3] !== undefined ? m[3] : null

      const ns = namespaces.get(nsName)

      // Subranges
      const atCol = matchStart // @
      const nsStart = matchStart + 1 // namespace start
      const nsEnd = nsStart + nsName.length

      let tStart = nsEnd,
        tEnd = nsEnd
      if (tagName) {
        tStart = nsEnd + 1 // after .
        tEnd = tStart + tagName.length
      }

      let argsStart = 0,
        argsEnd = 0
      if (rawArgs !== null) {
        argsStart = matchStart + m[0].indexOf('(') + 1
        argsEnd = argsStart + rawArgs.length
      }

      // 1. Hovering over @namespace
      if (col >= atCol && col < (tagName ? tStart - 1 : rawArgs !== null ? argsStart - 1 : matchEnd)) {
        return this.hoverNamespace(ns, nsName, nsStart, nsEnd)
      }

      // 2. Hovering over .tag
      if (tagName && col >= tStart && col <= tEnd) {
        return this.hoverTag(ns, nsName, tagName, tStart, tEnd)
      }

      // 3. Hovering inside args
      if (rawArgs !== null && col >= argsStart && col <= argsEnd) {
        const tagDef = ns ? (tagName ? ns.tags[tagName] : ns.tags.$self) : undefined
        if (tagDef?.args) {
          return this.hoverArg(col, rawArgs, argsStart, tagDef)
        }
      }
    }

    return undefined
  }

  private hoverNamespace(
    ns: TagNamespace | undefined,
    nsName: string,
    _nsStart: number,
    _nsEnd: number,
  ): vscode.Hover | undefined {
    if (!ns) return undefined

    const md = new vscode.MarkdownString()
    md.appendMarkdown(`**@${nsName}** — *namespace*\n\n`)

    // If $self exists, show its description
    const selfDef = ns.tags.$self
    if (selfDef?.description) {
      md.appendMarkdown(`${selfDef.description}\n\n`)
    }

    // List available tags
    const tags = Object.entries(ns.tags).filter(([k]) => k !== '$self')
    if (tags.length > 0) {
      md.appendMarkdown('**Tags:**\n')
      for (const [name, def] of tags) {
        const sig = formatTagSignature(nsName, name, def)
        const desc = def.description ? ` — ${def.description}` : ''
        md.appendMarkdown(`- \`${sig}\`${desc}\n`)
      }
    }

    return new vscode.Hover(md)
  }

  private hoverTag(
    ns: TagNamespace | undefined,
    nsName: string,
    tagName: string,
    _tStart: number,
    _tEnd: number,
  ): vscode.Hover | undefined {
    if (!ns) return undefined
    const tagDef = ns.tags[tagName]
    if (!tagDef) return undefined

    const md = new vscode.MarkdownString()
    const sig = formatTagSignature(nsName, tagName, tagDef)
    md.appendCodeblock(sig, 'plaintext')

    if (tagDef.description) {
      md.appendMarkdown(`${tagDef.description}\n\n`)
    }

    // Show arg details
    if (tagDef.args) {
      if (Array.isArray(tagDef.args)) {
        md.appendMarkdown('**Arguments (positional):**\n')
        tagDef.args.forEach((arg, i) => {
          md.appendMarkdown(`- \`[${i}]\`: \`${formatType(arg)}\`\n`)
        })
      } else {
        md.appendMarkdown('**Arguments (named):**\n')
        for (const [key, argDef] of Object.entries(tagDef.args)) {
          const req = (argDef as any).required ? ' *(required)*' : ''
          md.appendMarkdown(`- \`${key}\`: \`${formatType(argDef)}\`${req}\n`)
        }
      }
    }

    return new vscode.Hover(md)
  }

  private hoverArg(col: number, rawArgs: string, argsStart: number, tagDef: TagDef): vscode.Hover | undefined {
    const cursorOffset = col - argsStart
    const args = tagDef.args!

    if (Array.isArray(args)) {
      // Positional — figure out which index the cursor is in
      const idx = countCommasOutsideBrackets(rawArgs.substring(0, cursorOffset))
      if (idx >= args.length) return undefined

      const argType = args[idx]
      // Find the word under cursor
      const word = getWordAt(rawArgs, cursorOffset)

      const md = new vscode.MarkdownString()
      md.appendMarkdown(`**Argument [${idx}]**: \`${formatType(argType)}\`\n\n`)

      if (argType.type === 'enum') {
        const isValid = word && argType.values.includes(word)
        md.appendMarkdown(`Allowed values: ${argType.values.map((v) => `\`${v}\``).join(', ')}\n\n`)
        if (word && isValid) {
          md.appendMarkdown(`Current: \`${word}\``)
        }
      } else if (argType.type === 'string') {
        md.appendMarkdown(`Expects a string value`)
      }

      return new vscode.Hover(md)
    } else {
      // Named args — figure out if we're on a key, a value, or inside an array
      return this.hoverNamedArg(col, rawArgs, argsStart, args)
    }
  }

  private hoverNamedArg(
    col: number,
    rawArgs: string,
    argsStart: number,
    argDefs: Record<string, ArgType & { required?: boolean }>,
  ): vscode.Hover | undefined {
    const cursorOffset = col - argsStart

    // Find which key: value pair the cursor is in
    // Parse key: value segments
    const NAMED_RE = /(\w+)(\s*:\s*)((?:\[[^\]]*\]|'[^']*'|"[^"]*"|\w+))/g
    let m: RegExpExecArray | null
    while ((m = NAMED_RE.exec(rawArgs)) !== null) {
      const keyStart = m.index
      const keyEnd = keyStart + m[1].length
      const colonEnd = keyStart + m[1].length + m[2].length
      const valueStart = colonEnd
      const valueEnd = colonEnd + m[3].length
      const key = m[1]
      const _valueStr = m[3]

      const def = argDefs[key]

      // Hovering over the key name
      if (cursorOffset >= keyStart && cursorOffset < keyEnd) {
        if (!def) return undefined
        const md = new vscode.MarkdownString()
        const req = (def as any).required ? ' *(required)*' : ' *(optional)*'
        md.appendMarkdown(`**${key}**: \`${formatType(def)}\`${req}\n\n`)
        if (def.type === 'enum') {
          md.appendMarkdown(`Allowed values: ${def.values.map((v: string) => `\`${v}\``).join(', ')}`)
        } else if (def.type === 'array' && def.items.type === 'enum') {
          md.appendMarkdown(`Allowed values: ${def.items.values.map((v: string) => `\`${v}\``).join(', ')}`)
        }
        return new vscode.Hover(md)
      }

      // Hovering over the value
      if (cursorOffset >= valueStart && cursorOffset <= valueEnd && def) {
        // If it's an array value like [update, delete], find the word under cursor
        if (def.type === 'array') {
          const word = getWordAt(rawArgs, cursorOffset)
          const md = new vscode.MarkdownString()
          md.appendMarkdown(`**${key}**: \`${formatType(def)}\`\n\n`)
          if (def.items.type === 'enum') {
            const isValid = word && def.items.values.includes(word)
            md.appendMarkdown(`Allowed values: ${def.items.values.map((v: string) => `\`${v}\``).join(', ')}\n\n`)
            if (word) {
              md.appendMarkdown(isValid ? `\`${word}\` — valid` : `\`${word}\` — **invalid**`)
            }
          }
          return new vscode.Hover(md)
        }

        if (def.type === 'enum') {
          const word = getWordAt(rawArgs, cursorOffset)
          const md = new vscode.MarkdownString()
          md.appendMarkdown(`**${key}**: \`${formatType(def)}\`\n\n`)
          md.appendMarkdown(`Allowed values: ${def.values.map((v: string) => `\`${v}\``).join(', ')}\n\n`)
          if (word) {
            const isValid = def.values.includes(word)
            md.appendMarkdown(isValid ? `\`${word}\` — valid` : `\`${word}\` — **invalid**`)
          }
          return new vscode.Hover(md)
        }

        // String or other type
        const md = new vscode.MarkdownString()
        md.appendMarkdown(`**${key}**: \`${formatType(def)}\``)
        return new vscode.Hover(md)
      }
    }

    return undefined
  }
}

// ── Document link provider (ctrl+click on @import paths) ──────────────

const IMPORT_PATH_RE = /--\s*@import\s+(['"])([^'"]+)\1/

class ImportDocumentLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(doc: vscode.TextDocument): vscode.DocumentLink[] {
    const links: vscode.DocumentLink[] = []

    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i).text
      const m = IMPORT_PATH_RE.exec(line)
      if (!m) continue

      const importPath = m[2]
      const pathStart = m.index + m[0].indexOf(m[2])
      const pathEnd = pathStart + importPath.length
      const range = new vscode.Range(i, pathStart, i, pathEnd)

      const docDir = path.dirname(doc.uri.fsPath)
      let resolved: string | undefined
      if (importPath.startsWith('.')) {
        resolved = path.resolve(docDir, importPath)
      } else {
        try {
          resolved = require.resolve(importPath, { paths: [docDir] })
        } catch {
          // unresolvable — no link
        }
      }

      if (resolved) {
        const link = new vscode.DocumentLink(range, vscode.Uri.file(resolved))
        link.tooltip = resolved
        links.push(link)
      }
    }

    return links
  }
}

function formatTagSignature(nsName: string, tagName: string, def: TagDef): string {
  let sig = `@${nsName}.${tagName}`
  if (!def.args) return sig

  if (Array.isArray(def.args)) {
    const params = def.args.map((a, _i) => formatType(a)).join(', ')
    sig += `(${params})`
  } else {
    const params = Object.entries(def.args)
      .map(([k, v]) => `${k}: ${formatType(v)}`)
      .join(', ')
    sig += `(${params})`
  }
  return sig
}

function getWordAt(text: string, offset: number): string | null {
  // Expand left and right from offset to find word boundaries
  let start = offset
  let end = offset
  while (start > 0 && /\w/.test(text[start - 1])) start--
  while (end < text.length && /\w/.test(text[end])) end++
  if (start === end) return null
  return text.substring(start, end)
}

function countCommasOutsideBrackets(text: string): number {
  let count = 0
  let depth = 0
  for (const ch of text) {
    if (ch === '[') depth++
    else if (ch === ']') depth--
    else if (ch === ',' && depth === 0) count++
  }
  return count
}
