// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/schema/tag.go

import type { Attr, Tag } from './schema.ts'

/** Finds the first tag with the given name. Returns undefined if not found. */
export function findTag(attrs: Attr[] | undefined, name: string): Tag | undefined {
  if (!attrs) return undefined
  for (const a of attrs) {
    if ('kind' in a && (a as any).kind === 'tag' && (a as Tag).name === name) {
      return a as Tag
    }
  }
  return undefined
}

/** Returns all Tag attributes from the given attribute list. */
export function findTags(attrs: Attr[] | undefined): Tag[] {
  if (!attrs) return []
  const tags: Tag[] = []
  for (const a of attrs) {
    if ('kind' in a && (a as any).kind === 'tag') {
      tags.push(a as Tag)
    }
  }
  return tags
}

/** Reports whether the attribute list contains a tag with the given name. */
export function hasTag(attrs: Attr[] | undefined, name: string): boolean {
  return findTag(attrs, name) !== undefined
}
