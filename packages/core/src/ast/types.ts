import type { SqlTarget } from '../types.ts'

export interface SqlColumn {
  name: string
  type: string
  /** 1-based line number from AST span */
  line: number
}

export interface SqlStatement {
  kind: SqlTarget
  name: string
  /** 1-based line number from AST span */
  line: number
  columns: SqlColumn[]
  node: unknown
}

/** A parsed COMMENT ON statement from the source SQL */
export interface SqlCommentOn {
  /** e.g. 'TABLE "users"' or 'COLUMN "users"."email"' */
  targetKey: string
  /** The comment text */
  text: string
  /** 1-based line number */
  line: number
}
