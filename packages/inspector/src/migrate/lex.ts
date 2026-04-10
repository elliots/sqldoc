// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/migrate/lex.go

// -- Constants --

const EOS = -1
const DEFAULT_DELIMITER = ';'
const DELIMITER_CMD = 'delimiter'

// -- Regex Patterns --

/** Dollar-quoted string as defined by the PostgreSQL scanner. */
const reDollarQuote = /^\$([A-Za-z\xC8-\xFF_][\w\xC8-\xFF]*)?\$/

/** The 'BEGIN ATOMIC' syntax as specified in the SQL 2003 standard. */
const reBeginAtomic = /^\s*BEGIN\s+ATOMIC\s+/i

/** BEGIN TRY block (T-SQL). */
const reBeginTry = /^\s*BEGIN\s+TRY\s+/i

/** Generic BEGIN block. */
const reBegin = /^\s*BEGIN\s+/i

/** END keyword. */
const reEnd = /^\s*END\s*/i

/** END CATCH (T-SQL). */
const reEndCatch = /^\s*END\s*CATCH\s*/i

/** END as a terminator (at end of string). */
const reEndTerm = /\s*END\s*$/i

/** GO command (T-SQL). */
const reGoCmd = /^GO(?:\s+|$)/i

// -- Stmt --

/** A scanned statement text along with its position and associated comments. */
export interface Stmt {
  pos: number
  text: string
  comments: string[]
}

/** Returns all directive comments with the given name from a Stmt. */
export function stmtDirective(s: Stmt, name: string): string[] {
  const ds: string[] = []
  for (const c of s.comments) {
    if (c.startsWith('/*') && !c.includes('\n')) {
      const d = directive(c.replace(/\*\/$/, ''), name, '/*')
      if (d !== undefined) ds.push(d)
    } else {
      for (const p of ['#', '--', '-- ']) {
        const d = directive(c, name, p)
        if (d !== undefined) ds.push(d)
      }
    }
  }
  return ds
}

// -- Directive --

const reDirective = /^([ -~]*)atlas:(\w+)(?: +(.+))*/

/** Search content for a directive line matching the given prefix and name. */
export function directive(content: string, name: string, prefix?: string): string | undefined {
  const m = reDirective.exec(content)
  if (m && m[2] === name && (prefix === undefined || prefix === m[1])) {
    return m[3] ?? ''
  }
  return undefined
}

// -- Scanner Options --

export interface ScannerOptions {
  /** Enable matching for BEGIN ... END statement blocks. */
  matchBegin?: boolean
  /** Enable matching for BEGIN ATOMIC ... END statement blocks. */
  matchBeginAtomic?: boolean
  /** Enable matching for BEGIN TRY/CATCH ... END TRY/CATCH blocks. */
  matchBeginTryCatch?: boolean
  /** Enable PostgreSQL dollar-quoted string syntax. */
  matchDollarQuote?: boolean
  /** Enable backslash-escaped strings (MySQL/MariaDB). */
  backslashEscapes?: boolean
  /** Enable PG extension for escaped strings (E'...'). */
  escapedStringExt?: boolean
  /** Enable MySQL/MariaDB hash-like (#) comments. */
  hashComments?: boolean
  /** Enable the "GO" command as a delimiter. */
  goCommand?: boolean
  /** T-SQL option: terminate BEGIN/END blocks with semicolon. */
  beginEndTerminator?: boolean
  /** Omit delimiter from the statement text. */
  omitDelimiter?: boolean
}

// -- Scanner --

/** Splits SQL content into individual statements. */
export class Scanner {
  private opts: ScannerOptions
  private src = ''
  private input = ''
  private pos = 0
  private total = 0
  private width = 0
  private delim = DEFAULT_DELIMITER
  private comments: string[] = []
  private endterm: RegExp | null = null

  constructor(opts?: ScannerOptions) {
    this.opts = opts ?? {}
  }

  /** Scan returns all statements from the given input. */
  scan(input: string): Stmt[] {
    const stmts: Stmt[] = []
    this.init(input)
    for (;;) {
      const s = this.stmt()
      if (s === null) return stmts
      stmts.push(s)
    }
  }

  private init(input: string): void {
    this.comments = []
    this.pos = 0
    this.total = 0
    this.width = 0
    this.src = input
    this.input = input
    this.delim = DEFAULT_DELIMITER

    const d = directive(input, 'delimiter', '-- ')
    if (d !== undefined) {
      this.setDelim(d)
      const nl = input.indexOf('\n')
      if (nl === -1) {
        throw this.error(this.pos, `no input found after delimiter "${d}"`)
      }
      this.input = input.slice(nl + 1)
    }
  }

  private stmt(): Stmt | null {
    let depth = 0
    let openingPos = 0
    let text = ''

    this.skipSpaces()

    for (;;) {
      const r = this.next()
      if (r === EOS) {
        if (depth > 0) {
          throw this.error(openingPos, "unclosed '('")
        }
        if (this.pos > 0) {
          text = this.input
          break
        }
        return null
      }

      if (r === 0x28 /* ( */) {
        if (depth === 0) openingPos = this.pos
        depth++
        continue
      }

      if (r === 0x29 /* ) */) {
        if (depth === 0) {
          throw this.error(this.pos, "unexpected ')'")
        }
        depth--
        continue
      }

      if (r === 0x27 /* ' */ || r === 0x22 /* " */ || r === 0x60 /* ` */) {
        this.skipQuote(r)
        continue
      }

      // MySQL DELIMITER command at start of statement
      if (
        this.pos === 1 &&
        this.input.length > DELIMITER_CMD.length &&
        this.input.slice(0, DELIMITER_CMD.length).toLowerCase() === DELIMITER_CMD
      ) {
        this.addPos(DELIMITER_CMD.length - 1)
        this.delimCmd()
        this.skipSpaces()
        continue
      }

      // GO command: '\nGO'
      if (this.opts.goCommand && r === 0x0a /* \n */ && reGoCmd.test(this.input.slice(this.pos))) {
        this.next() // skip past 'G'
        text = this.input.slice(0, this.pos - 1)
        this.next() // skip 'O'
        this.skipGoCount()
        this.skipSpaces()
        break
      }

      if (
        this.opts.goCommand &&
        (this.pos === 1 || (this.pos > 1 && this.input.charCodeAt(this.pos - 2) === 0x0a)) &&
        reGoCmd.test(this.input.slice(this.pos - 1))
      ) {
        text = this.input.slice(0, this.pos - 1)
        this.next() // skip 'O'
        this.skipGoCount()
        this.skipSpaces()
        break
      }

      // Delimiter match (takes precedence over comments)
      if (depth === 0 && this.input.startsWith(this.delim, this.pos - this.width)) {
        this.addPos(this.delim.length - this.width)
        text = this.input.slice(0, this.pos)
        break
      }

      // Dollar-quoted strings
      if (this.opts.matchDollarQuote && r === 0x24 /* $ */ && reDollarQuote.test(this.input.slice(this.pos - 1))) {
        this.skipDollarQuote()
        continue
      }

      // Hash comments
      if (r === 0x23 /* # */ && this.opts.hashComments) {
        this.comment('#', '\n')
        continue
      }

      // Line comments (--)
      if (r === 0x2d /* - */ && this.pick() === 0x2d) {
        this.next()
        this.comment('--', '\n')
        continue
      }

      // Block comments
      if (r === 0x2f /* / */ && this.pick() === 0x2a /* * */) {
        this.next()
        this.comment('/*', '*/')
        continue
      }

      // End term (T-SQL)
      if (this.endterm?.test(this.input.slice(0, this.pos))) {
        text = this.input.slice(0, this.pos)
        break
      }

      // BEGIN ATOMIC block
      if (
        this.delim === DEFAULT_DELIMITER &&
        this.opts.matchBeginAtomic &&
        reBeginAtomic.test(this.input.slice(this.pos - 1))
      ) {
        try {
          this.skipBeginAtomic()
          text = this.input.slice(0, this.pos)
          break
        } catch {
          // Not a BEGIN ATOMIC block
        }
      }

      // BEGIN TRY/CATCH block
      if (
        this.delim === DEFAULT_DELIMITER &&
        this.opts.matchBeginTryCatch &&
        reBeginTry.test(this.input.slice(this.pos - 1))
      ) {
        try {
          this.skipBeginTryCatch()
          text = this.input.slice(0, this.pos)
          break
        } catch {
          // Not a BEGIN TRY block
        }
      }

      // BEGIN block
      if (
        this.delim === DEFAULT_DELIMITER &&
        this.opts.matchBegin &&
        ((this.pos === 1 && reBegin.test(this.input.slice(this.pos - 1))) ||
          (this.pos > 1 && reBegin.test(this.input.slice(this.pos - 2))))
      ) {
        try {
          this.skipBegin()
          text = this.input.slice(0, this.pos)
          break
        } catch {
          // Not a BEGIN block
        }
      }
    }

    return this.emit(text)
  }

  private next(): number {
    if (this.pos >= this.input.length) return EOS
    const code = this.input.codePointAt(this.pos)!
    const w = code > 0xffff ? 2 : 1
    this.width = w
    this.addPos(w)
    return code
  }

  private pick(): number {
    const p = this.pos
    const w = this.width
    const t = this.total
    const r = this.next()
    this.pos = p
    this.width = w
    this.total = t
    return r
  }

  private addPos(p: number): void {
    this.pos += p
    this.total += p
  }

  private skipQuote(quote: number): void {
    const pos = this.pos
    const escaped =
      this.opts.backslashEscapes ||
      (this.opts.escapedStringExt &&
        this.pos > 0 &&
        (this.input.charCodeAt(this.pos - 1) === 0x45 /* E */ || this.input.charCodeAt(this.pos - 1) === 0x65)) /* e */

    for (;;) {
      const r = this.next()
      if (r === EOS) {
        throw this.error(pos, `unclosed quote ${quoteChar(quote)}`)
      }
      if (r === 0x5c /* \\ */ && escaped) {
        this.next()
        continue
      }
      if (r === quote) {
        return
      }
    }
  }

  private skipDollarQuote(): void {
    const m = reDollarQuote.exec(this.input.slice(this.pos - 1))
    if (!m) {
      throw this.error(this.pos, 'unexpected dollar quote')
    }
    const tag = m[0]
    this.addPos(tag.length - 1)
    for (;;) {
      const r = this.next()
      if (r === EOS) {
        if (this.delim === '') {
          throw this.error(this.pos, 'unclosed dollar-quoted string')
        }
        return
      }
      if (r === 0x24 /* $ */ && this.input.startsWith(tag, this.pos - 1)) {
        this.addPos(tag.length - 1)
        return
      }
    }
  }

  private skipBeginAtomic(): void {
    const m = reBeginAtomic.exec(this.input.slice(this.pos - 1))
    if (!m) {
      throw this.error(this.pos, 'unexpected missing BEGIN ATOMIC block')
    }
    this.addPos(m[0].length - 1)
    const body = new Scanner(this.opts)
    body.init(this.input.slice(this.pos))
    for (;;) {
      const s = body.stmt()
      if (s === null) {
        throw this.error(this.pos, 'unexpected eof when scanning sql body')
      }
      if (reEnd.test(s.text)) break
    }
    this.addPos(body.total)
  }

  private skipBeginTryCatch(): void {
    const m = reBeginTry.exec(this.input.slice(this.pos - 1))
    if (!m) {
      throw this.error(this.pos, 'unexpected missing BEGIN TRY block')
    }
    this.addPos(m[0].length - 1)
    const body = new Scanner(this.opts)
    body.init(this.input.slice(this.pos))
    for (;;) {
      const s = body.stmt()
      if (s === null) {
        throw this.error(this.pos, 'unexpected eof when scanning sql body')
      }
      const endMatch = reEndCatch.exec(s.text)
      if (endMatch) {
        const end = endMatch[0]
        if (!end.trimEnd().endsWith(';')) {
          this.addPos(-(s.text.length - end.length))
        }
        break
      }
    }
    this.addPos(body.total)
  }

  private skipBegin(): void {
    const m = reBegin.exec(this.input.slice(this.pos - 1))
    if (!m) {
      throw this.error(this.pos, 'unexpected missing BEGIN block')
    }
    this.addPos(m[0].length - 1)
    const group = new Scanner(this.opts)
    if (this.opts.beginEndTerminator) {
      group.endterm = reEndTerm
    }
    group.init(this.input.slice(this.pos))
    for (;;) {
      const s = group.stmt()
      if (s === null) {
        throw this.error(this.pos, 'unexpected eof when scanning compound statements')
      }
      if (reEnd.test(s.text)) {
        const endMatch = reEnd.exec(s.text)
        if (endMatch) {
          const matched = endMatch[0]
          if (matched.length === s.text.length || s.text.slice(matched.length) === this.delim) {
            break
          }
        }
      }
      if (this.opts.beginEndTerminator && reEndTerm.test(s.text)) {
        break
      }
    }
    this.addPos(group.total)
  }

  private comment(left: string, right: string): void {
    const i = this.input.indexOf(right, this.pos)
    if (i === -1) {
      if (right === '\n') {
        // Line comment without trailing newline -- skip to end.
        this.addPos(this.input.length - this.pos)
      }
      return
    }
    // If the comment resides inside a statement, collect it.
    if (this.pos !== left.length) {
      this.addPos(i - this.pos + right.length)
      return
    }
    this.addPos(i - this.pos + right.length)
    // If we did not scan any statement characters, it
    // can be skipped and stored in the comments group.
    this.comments.push(this.input.slice(0, this.pos))
    this.input = this.input.slice(this.pos)
    this.pos = 0
    // Double \n separate the comments group from the statement.
    if (this.input.startsWith('\n\n') || (right === '\n' && this.input.startsWith('\n'))) {
      this.comments = []
    }
    this.skipSpaces()
  }

  private skipSpaces(): void {
    const n = this.input.length
    this.input = this.input.replace(/^\s+/, '')
    this.total += n - this.input.length
  }

  private emit(text: string): Stmt {
    const stmt: Stmt = {
      pos: this.total - text.length,
      text,
      comments: [...this.comments],
    }
    this.input = this.input.slice(this.pos)
    this.pos = 0
    this.comments = []
    // Trim delimiter if requested or is not the default one.
    if (this.opts.omitDelimiter || this.delim !== DEFAULT_DELIMITER) {
      if (stmt.text.endsWith(this.delim)) {
        stmt.text = stmt.text.slice(0, -this.delim.length)
      }
    }
    stmt.text = stmt.text.trim()
    return stmt
  }

  private delimCmd(): void {
    if (this.pick() !== 0x20 /* space */) return
    // Scan delimiter.
    for (let r = this.pick(); r !== EOS && r !== 0x0a /* \n */; r = this.next()) {
      // advance
    }
    let delim = this.input.slice(DELIMITER_CMD.length, this.pos).trim()
    // MySQL client allows quoting delimiters.
    if (delim.startsWith("'") && delim.endsWith("'")) {
      delim = delim.slice(1, -1).replaceAll("''", "'")
    }
    this.setDelim(delim)
    // Skip all we saw until now.
    this.emit(this.input.slice(0, this.pos))
  }

  private skipGoCount(): void {
    if (this.pick() === 0x20 /* space */) {
      const c = this.pos
      for (let r = this.pick(); r !== EOS && r !== 0x0a; r = this.next()) {
        // advance
      }
      const countStr = this.input.slice(c, this.pos).trim()
      if (countStr && Number.isNaN(Number.parseInt(countStr, 10))) {
        throw new Error(`sql/migrate: invalid GO command, expect digits got "${countStr}"`)
      }
    }
  }

  private setDelim(d: string): void {
    if (!d) throw new Error('empty delimiter')
    this.delim = d.replaceAll('\\n', '\n').replaceAll('\\r', '\r').replaceAll('\\t', '\t')
  }

  private error(pos: number, msg: string): Error {
    const p = this.src.length - this.input.length + pos
    const src = this.src.slice(0, p)
    const line = 1 + (src.match(/\n/g) ?? []).length
    let col: number
    const lastNl = src.lastIndexOf('\n')
    if (line === 1) {
      col = p
    } else {
      col = p - lastNl - 1
    }
    return new Error(`${line}:${col}: ${msg}`)
  }
}

// -- Convenience Functions --

/** Split SQL input into statement texts using default options. */
export function stmts(input: string): string[] {
  const scanner = new Scanner({
    matchBeginAtomic: true,
    matchDollarQuote: true,
  })
  return scanner.scan(input).map((s) => s.text)
}

/** Split SQL input into Stmt objects using default options. */
export function scanStmts(input: string): Stmt[] {
  const scanner = new Scanner({
    matchBeginAtomic: true,
    matchDollarQuote: true,
  })
  return scanner.scan(input)
}

// -- Helpers --

function quoteChar(code: number): string {
  if (code === 0x27) return "'\\''"
  if (code === 0x22) return "'\"'"
  if (code === 0x60) return "'`'"
  return `'${String.fromCodePoint(code)}'`
}
