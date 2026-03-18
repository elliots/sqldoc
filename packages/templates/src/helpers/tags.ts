interface TagInfo {
  namespace: string
  tag: string | null
  args: Record<string, unknown> | unknown[]
}

/** Find @codegen.rename for a specific object, optionally scoped to template */
export function findRename(tags: TagInfo[], templateName: string): string | undefined {
  // First check template-specific rename
  const specific = tags.find(
    (t) =>
      t.namespace === 'codegen' &&
      t.tag === 'rename' &&
      Array.isArray(t.args) &&
      t.args.length === 2 &&
      t.args[1] === templateName,
  )
  if (specific && Array.isArray(specific.args)) return specific.args[0] as string

  // Then check global rename (single arg)
  const global = tags.find(
    (t) => t.namespace === 'codegen' && t.tag === 'rename' && Array.isArray(t.args) && t.args.length === 1,
  )
  if (global && Array.isArray(global.args)) return global.args[0] as string

  return undefined
}

/** Check if @codegen.skip applies to this template */
export function isSkipped(tags: TagInfo[], templateName: string): boolean {
  return tags.some(
    (t) =>
      t.namespace === 'codegen' &&
      t.tag === 'skip' &&
      // Global skip (no args or empty)
      (!Array.isArray(t.args) ||
        t.args.length === 0 ||
        // Template-specific skip
        (Array.isArray(t.args) && t.args[0] === templateName)),
  )
}

/** Find @codegen.type override for a column, optionally scoped to template */
export function findTypeOverride(tags: TagInfo[], templateName: string): string | undefined {
  // First check template-specific type override
  const specific = tags.find(
    (t) =>
      t.namespace === 'codegen' &&
      t.tag === 'type' &&
      Array.isArray(t.args) &&
      t.args.length === 2 &&
      t.args[1] === templateName,
  )
  if (specific && Array.isArray(specific.args)) return specific.args[0] as string

  // Then check global type override (single arg)
  const global = tags.find(
    (t) => t.namespace === 'codegen' && t.tag === 'type' && Array.isArray(t.args) && t.args.length === 1,
  )
  if (global && Array.isArray(global.args)) return global.args[0] as string

  return undefined
}
