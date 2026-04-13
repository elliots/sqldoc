// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/migrate/dir.go

import type { Tag } from '../schema/schema.ts'
import { Scanner, type Stmt } from './lex.ts'
import { parseTags } from './tag.ts'

// -- File Interface --

/** A migration file with name and content. */
export interface File {
  /** The file name. */
  readonly name: string
  /** The raw file content. */
  readonly content: string
  /** The SQL statements in this file (parsed via Scanner). */
  stmts(): string[]
  /** The Stmt declarations in this file (parsed via Scanner). */
  stmtDecls(): Stmt[]
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
  readonly name: string
  readonly content: string
  private _stmtDecls: Stmt[] | undefined

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
    if (this._stmtDecls) return this._stmtDecls
    const scanner = new Scanner({
      matchBeginAtomic: true,
      matchDollarQuote: true,
    })
    this._stmtDecls = scanner.scan(this.content)
    return this._stmtDecls
  }

  tags(): Tag[] {
    const allComments: string[] = []
    for (const s of this.stmtDecls()) {
      allComments.push(...s.comments)
    }
    return parseTags(allComments)
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
