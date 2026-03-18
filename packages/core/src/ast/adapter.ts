import type { SqlCommentOn, SqlStatement } from './types.ts'

export interface SqlAstAdapter {
  /** Initialize the parser (WASM loading, etc.) */
  init(): Promise<void>
  /** Parse SQL text and return normalized statements */
  parseStatements(sql: string): SqlStatement[]
  /** Parse COMMENT ON statements from SQL text */
  parseComments(sql: string): SqlCommentOn[]
}
