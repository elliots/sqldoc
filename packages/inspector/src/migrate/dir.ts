// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/migrate/dir.go

import type { Tag } from '../schema/schema.ts'
import { type Stmt, Scanner, directive } from './lex.ts'
import { parseTags } from './tag.ts'

// -- File Interface --

/** A migration file with name and content. */
export interface File {
  /** The file name. */
  name: string
  /** The raw file content. */
  content: string
  /** The SQL statements in this file (parsed via Scanner). */
  stmts(): string[]
  /** The Stmt declarations in this file (parsed via Scanner). */
  stmtDecls(): Stmt[]
  /** File-level directives matching the given name. */
  fileDirective(name: string): string[]
  /** Tags extracted from all statement comments. */
  tags(): Tag[]
}

// -- Dir Interface --

/** A read-only directory of migration files. */
export interface Dir {
  /** Open a file by name. Returns undefined if not found. */
  open(name: string): File | undefined
  /** List all SQL files, sorted by name. */
  files(): File[]
}

// -- LocalFile --

/** A file with name and content stored in memory. */
export class LocalFile implements File {
  name: string
  content: string

  constructor(name: string, content: string) {
    this.name = name
    this.content = content
  }

  /** Description extracted from filename (part after first underscore, without .sql). */
  desc(): string {
    const parts = this.name.split('_')
    if (parts.length === 1) return ''
    return parts
      .slice(1)
      .join('_')
      .replace(/\.sql$/, '')
  }

  /** Version extracted from filename (part before first underscore). */
  version(): string {
    return this.name.replace(/\.sql$/, '').split('_')[0]
  }

  stmts(): string[] {
    return this.stmtDecls().map((s) => s.text)
  }

  stmtDecls(): Stmt[] {
    const scanner = new Scanner({
      matchBeginAtomic: true,
      matchDollarQuote: true,
    })
    return scanner.scan(this.content)
  }

  fileDirective(name: string): string[] {
    const ds: string[] = []
    for (const c of this.topComments()) {
      const d = directive(c, name)
      if (d !== undefined) ds.push(d)
    }
    return ds
  }

  tags(): Tag[] {
    const allComments: string[] = []
    for (const s of this.stmtDecls()) {
      allComments.push(...s.comments)
    }
    return parseTags(allComments)
  }

  /** Extract top-of-file comments (before the first double newline). */
  private topComments(): string[] {
    const lines: string[] = []
    for (const line of this.content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') break
      lines.push(trimmed)
    }
    return lines
  }
}

// -- MemDir --

/** In-memory directory of migration files. */
export class MemDir implements Dir {
  private fs: Map<string, LocalFile> = new Map()

  /** Add a file to the directory. */
  addFile(name: string, content: string): void {
    this.fs.set(name, new LocalFile(name, content))
  }

  /** Write a file (alias for addFile, matches Go API). */
  writeFile(name: string, content: string): void {
    this.addFile(name, content)
  }

  /** Get a file by name. Returns undefined if not found. */
  open(name: string): File | undefined {
    return this.fs.get(name)
  }

  /** List all .sql files, sorted by name. */
  files(): File[] {
    const result: File[] = []
    for (const f of this.fs.values()) {
      if (f.name.endsWith('.sql')) {
        result.push(f)
      }
    }
    result.sort((a, b) => a.name.localeCompare(b.name))
    return result
  }

  /** Check if a file exists. */
  has(name: string): boolean {
    return this.fs.has(name)
  }

  /** List all files including non-.sql files, sorted by name. */
  allFiles(): File[] {
    const result: File[] = [...this.fs.values()]
    result.sort((a, b) => a.name.localeCompare(b.name))
    return result
  }

  /** Reset the directory to empty. */
  reset(): void {
    this.fs.clear()
  }
}
