import { dedent } from './dedent.ts'

// Re-export dedent for direct use
export { dedent }

// Each tag function is just dedent with a name (for grammar injection matching)
export const ts = dedent
export const go = dedent
export const python = dedent
export const sql = dedent
export const java = dedent
export const kotlin = dedent
export const rust = dedent
export const csharp = dedent
