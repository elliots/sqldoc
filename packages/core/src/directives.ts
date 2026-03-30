/**
 * Parses @external and @include directives from SQL comments.
 * These directives reference external SQL files for schema extension and inclusion.
 */

// -- Types --

/** Provenance of a SQL file in the project */
export type FileProvenance = 'project' | 'external' | 'include'

/** A parsed @external or @include directive */
export interface FileDirective {
  type: 'external' | 'include'
  /** Raw path from directive (may be a glob pattern) */
  path: string
  /** 0-based line number */
  line: number
  startCol: number
  endCol: number
}

// -- Regexes --

export const EXTERNAL_RE = /--\s*@external\s+(['"])([^'"]+)\1/g
export const INCLUDE_RE = /--\s*@include\s+(['"])([^'"]+)\1/g

// -- Parser --

/**
 * Parse @external and @include directives from SQL text.
 * Returns an array of FileDirective objects with line/col info.
 */
export function parseDirectives(text: string): FileDirective[] {
  const directives: FileDirective[] = []
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Check @external
    EXTERNAL_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = EXTERNAL_RE.exec(line)) !== null) {
      directives.push({
        type: 'external',
        path: m[2],
        line: i,
        startCol: m.index,
        endCol: m.index + m[0].length,
      })
    }

    // Check @include
    INCLUDE_RE.lastIndex = 0
    while ((m = INCLUDE_RE.exec(line)) !== null) {
      directives.push({
        type: 'include',
        path: m[2],
        line: i,
        startCol: m.index,
        endCol: m.index + m[0].length,
      })
    }
  }

  return directives
}
