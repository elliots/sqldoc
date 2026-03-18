import type { SqlTarget } from '../types.ts'

export interface SqlColumn {
  name: string
  dataType: string
  /** 1-based line number from AST span */
  line: number
  raw: unknown
}

export interface SqlStatement {
  kind: SqlTarget
  objectName: string
  /** 1-based line number from AST span */
  line: number
  columns?: SqlColumn[]
  raw: unknown
}

/** A parsed COMMENT ON statement from the source SQL */
export interface SqlCommentOn {
  /** e.g. 'TABLE "users"' or 'COLUMN "users"."email"' */
  targetKey: string
  /** The comment text */
  content: string
  /** 1-based line number */
  line: number
}
