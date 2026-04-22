// Derived from Atlas by Atlas Authors, licensed under Apache 2.0
// Source: sql/internal/sqlx/plan.go, sql/internal/sqlx/sqlx_oss.go

import type { AddTable, Change, Clause, DropObject, DropTable, ModifyTable, Plan } from '../schema/migrate.ts'

// -- Clause Helpers --

/** Check if a change's extra clauses contain a specific clause type. Equivalent to sqlx.Has in the original Go code. */
export function hasClause(extra: Clause[] | undefined, type: string): boolean {
  return extra?.some((c) => c.type === type) ?? false
}

/** Annotate all drop changes with IF EXISTS clauses. Used by restore to handle dependency ordering. */
export function withIfExists(changes: Change[]): Change[] {
  const ifExistsExtra: Clause[] = [{ type: 'if_exists' }]
  for (const c of changes) {
    if (c.type.startsWith('drop_') && 'extra' in c) {
      ;(c as any).extra = [...((c as any).extra ?? []), ...ifExistsExtra]
    }
  }
  return changes
}

import type { ForeignKey, Func, ObjectRef, Proc, Schema, Sequence, Table, Trigger, View } from '../schema/schema.ts'

// -- PlanDriver Interface --

/**
 * PlanDriver wraps all required methods for generating SQL from changes.
 * Each dialect (postgres, mysql, sqlite) implements this interface.
 */
export interface PlanDriver {
  /** Default schema to strip from qualified names in generated SQL. */
  defaultSchema?: string
  /** Generate SQL for creating a schema. */
  addSchema?(schema: Schema): string[]
  /** Generate SQL for dropping a schema. Extra clauses may include IF EXISTS, CASCADE. */
  dropSchema?(schema: Schema, extra?: Clause[]): string[]
  /** Generate SQL for adding a table. */
  addTable(table: Table): string[]
  /** Generate SQL for dropping a table. Extra clauses may include IF EXISTS, CASCADE. */
  dropTable(table: Table, extra?: Clause[]): string[]
  /** Generate SQL for modifying a table (column/index/FK changes). */
  modifyTable(from: Table, to: Table, changes: Change[]): string[]
  /** Generate SQL for adding a view. */
  addView?(view: View): string[]
  /** Generate SQL for dropping a view. Extra clauses may include IF EXISTS, CASCADE. */
  dropView?(view: View, extra?: Clause[]): string[]
  /** Generate SQL for modifying a view. */
  modifyView?(from: View, to: View): string[]
  /** Generate SQL for adding a function. */
  addFunc?(func: Func): string[]
  /** Generate SQL for dropping a function. Extra clauses may include IF EXISTS, CASCADE. */
  dropFunc?(func: Func, extra?: Clause[]): string[]
  /** Generate SQL for modifying a function. */
  modifyFunc?(from: Func, to: Func, changes: Change[]): string[]
  /** Generate SQL for adding a trigger. */
  addTrigger?(trigger: Trigger): string[]
  /** Generate SQL for dropping a trigger. Extra clauses may include IF EXISTS, CASCADE. */
  dropTrigger?(trigger: Trigger, extra?: Clause[]): string[]
  /** Generate SQL for adding a sequence. */
  addSequence?(seq: Sequence): string[]
  /** Generate SQL for dropping a sequence. Extra clauses may include IF EXISTS, CASCADE. */
  dropSequence?(seq: Sequence, extra?: Clause[]): string[]
  /** Generate SQL for modifying a sequence. */
  modifySequence?(from: Sequence, to: Sequence): string[]
  /** Generate SQL for adding a schema-level object (enum, domain, composite, extension). */
  addObject?(obj: any): string[]
  /** Generate SQL for dropping a schema-level object. Extra clauses may include IF EXISTS, CASCADE. */
  dropObject?(obj: any, extra?: Clause[]): string[]
  /** Generate SQL for adding a procedure. */
  addProc?(proc: Proc): string[]
  /** Generate SQL for dropping a procedure. Extra clauses may include IF EXISTS, CASCADE. */
  dropProc?(proc: Proc, extra?: Clause[]): string[]
  /** Generate SQL for modifying a procedure. */
  modifyProc?(from: Proc, to: Proc, changes: Change[]): string[]
}

/** Options for the plan engine. */
export interface PlanOptions {
  /** Whether to wrap operations in a transaction. */
  transactional?: boolean
}

// -- Comparison Helpers --

/** Build a schema-qualified name for use as a map key. */
function qualifiedName(name: string, schema?: string): string {
  return schema ? `${schema}.${name}` : name
}

/** Reports if two schema strings are the same. */
function sameSchema(a: string | undefined, b: string | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a === b
}

/** Reports if a foreign key references a given table name+schema. */
function fkRefsTable(fk: ForeignKey, tableName: string, tableSchema?: string): boolean {
  return fk.refTable === tableName && sameSchema(fk.refSchema, tableSchema)
}

/** Reports if any FK in the list references the given table. */
function refTo(fks: ForeignKey[] | undefined, t: Table): boolean {
  if (!fks || fks.length === 0) return false
  return fks.some((fk) => fkRefsTable(fk, t.name, t.schema))
}

/** Reports if an ObjectRef matches a table. */
function refMatchesTable(ref: ObjectRef, t: Table): boolean {
  return ref.type === 'table' && ref.name === t.name && sameSchema(ref.schema, t.schema)
}

/** Reports if an ObjectRef matches a view. */
function refMatchesView(ref: ObjectRef, v: View): boolean {
  return ref.type === 'view' && ref.name === v.name && sameSchema(ref.schema, v.schema)
}

/** Reports if an ObjectRef matches a func (by name and schema, ignoring overloads). */
function refMatchesFunc(ref: ObjectRef, f: Func): boolean {
  return ref.type === 'func' && ref.name === f.name && sameSchema(ref.schema, f.schema)
}

/** Reports if an ObjectRef matches a proc (by name and schema). */
function refMatchesProc(ref: ObjectRef, p: Proc): boolean {
  return ref.type === 'proc' && ref.name === p.name && sameSchema(ref.schema, p.schema)
}

/** Reports if two ObjectRefs match. */
function sameRef(a: ObjectRef, b: ObjectRef): boolean {
  return a.type === b.type && a.name === b.name && sameSchema(a.schema, b.schema)
}

/** Reports if a deps list contains a given ObjectRef. */
function depsContain(deps: ObjectRef[] | undefined, ref: ObjectRef): boolean {
  if (!deps) return false
  return deps.some((d) => sameRef(d, ref))
}

// -- DetachCycles --

/**
 * DetachCycles takes a list of schema changes, and detaches references between
 * changes if there is at least one circular reference in the changeset.
 * More explicitly, it postpones FK creation, or deletes FKs before deleting their tables.
 *
 * Ported from Go: sql/internal/sqlx/plan.go:DetachCycles
 */
export function detachCycles(changes: Change[]): Change[] {
  const result = sortMap(changes)
  if (result.cycle) {
    return detachReferences(changes)
  }
  if (result.error) {
    throw new Error(result.error)
  }
  // Sort by topological order (reversed — lower index = should come first)
  const sorted = result.sorted!
  const planned = [...changes]
  planned.sort((a, b) => {
    const ka = tableName(a)
    const kb = tableName(b)
    return (sorted.get(ka) ?? 0) - (sorted.get(kb) ?? 0)
  })
  return planned
}

/**
 * detachReferences detaches all table references when cycles exist.
 * For AddTable: moves external FKs to deferred ModifyTable changes.
 * For DropTable: prepends FK drops before the table drop.
 * For ModifyTable: separates AddForeignKey into deferred changes.
 *
 * Ported from Go: sql/internal/sqlx/plan.go:detachReferences
 */
function detachReferences(changes: Change[]): Change[] {
  const planned: Change[] = []
  const deferred: Change[] = []

  for (const change of changes) {
    switch (change.type) {
      case 'add_table': {
        const t = change.T
        const selfFks: ForeignKey[] = []
        const extFkChanges: Change[] = []

        for (const fk of t.foreignKeys ?? []) {
          // Self-referencing FK (same table)
          if (fk.refTable === t.name && sameSchema(fk.refSchema, t.schema)) {
            selfFks.push(fk)
          } else {
            extFkChanges.push({ type: 'add_foreign_key', F: fk } as Change)
          }
        }

        if (extFkChanges.length > 0) {
          deferred.push({ type: 'modify_table', T: t, changes: extFkChanges } as ModifyTable)
          // Create table with only self-referencing FKs
          const tCopy: Table = { ...t, foreignKeys: selfFks.length > 0 ? selfFks : undefined }
          planned.push({ type: 'add_table', T: tCopy, extra: change.extra } as AddTable)
        } else {
          planned.push(change)
        }
        break
      }

      case 'drop_table': {
        const t = change.T
        const fkDrops: Change[] = []

        for (const fk of t.foreignKeys ?? []) {
          // Non-self-referencing FKs need to be dropped first
          if (fk.refTable !== t.name || !sameSchema(fk.refSchema, t.schema)) {
            fkDrops.push({ type: 'drop_foreign_key', F: fk } as Change)
          }
        }

        if (fkDrops.length > 0) {
          planned.push({ type: 'modify_table', T: t, changes: fkDrops } as ModifyTable)
          const tCopy: Table = { ...t, foreignKeys: undefined }
          deferred.push({ type: 'drop_table', T: tCopy, extra: change.extra } as DropTable)
        } else {
          deferred.push(change)
        }
        break
      }

      case 'modify_table': {
        const fks: Change[] = []
        const rest: Change[] = []

        for (const c of change.changes) {
          if (c.type === 'add_foreign_key') {
            fks.push(c)
          } else {
            rest.push(c)
          }
        }

        if (fks.length > 0) {
          deferred.push({ type: 'modify_table', T: change.T, changes: fks } as ModifyTable)
        }
        if (rest.length > 0) {
          planned.push({ type: 'modify_table', T: change.T, changes: rest } as ModifyTable)
        }
        break
      }

      default:
        planned.push(change)
        break
    }
  }

  return [...planned, ...deferred]
}

// -- sortMap (cycle detection via DFS) --

interface SortMapResult {
  sorted?: Map<string, number>
  cycle: boolean
  error?: string
}

/**
 * Returns an index-map indicating the position of each table in a topological
 * sort in reversed order based on its references. Reports cycle if found.
 *
 * Ported from Go: sql/internal/sqlx/plan.go:sortMap
 */
function sortMap(changes: Change[]): SortMapResult {
  const deps = dependencies(changes)
  if (deps.error) {
    return { cycle: false, error: deps.error }
  }
  const depMap = deps.deps!
  const sorted = new Map<string, number>()
  const progress = new Set<string>()

  function visit(name: string): boolean {
    if (sorted.has(name)) return false
    if (progress.has(name)) return true // cycle
    progress.add(name)
    for (const ref of depMap.get(name) ?? []) {
      if (visit(ref)) return true
    }
    progress.delete(name)
    sorted.set(name, sorted.size)
    return false
  }

  // Visit nodes in sorted key order for deterministic output
  const keys = [...depMap.keys()].sort()
  for (const key of keys) {
    if (visit(key)) {
      return { cycle: true }
    }
  }

  return { sorted, cycle: false }
}

interface DependenciesResult {
  deps?: Map<string, string[]>
  error?: string
}

/**
 * Returns an adjacency list of all tables and the tables they depend on.
 *
 * Ported from Go: sql/internal/sqlx/plan.go:dependencies
 */
function dependencies(changes: Change[]): DependenciesResult {
  const deps = new Map<string, string[]>()

  function addDep(from: string, to: string) {
    const list = deps.get(from) ?? []
    list.push(to)
    deps.set(from, list)
  }

  // Ensure every table has an entry (even if no deps)
  function ensureEntry(name: string) {
    if (!deps.has(name)) {
      deps.set(name, [])
    }
  }

  for (const change of changes) {
    switch (change.type) {
      case 'add_table': {
        const key = qualifiedName(change.T.name, change.T.schema)
        ensureEntry(key)
        for (const fk of change.T.foreignKeys ?? []) {
          const err = checkFK(fk)
          if (err) return { error: err }
          // Non-self-referencing FK
          if (fk.refTable !== change.T.name || !sameSchema(fk.refSchema, change.T.schema)) {
            addDep(key, qualifiedName(fk.refTable, fk.refSchema))
          }
        }
        break
      }

      case 'drop_table': {
        const key = qualifiedName(change.T.name, change.T.schema)
        ensureEntry(key)
        for (const fk of change.T.foreignKeys ?? []) {
          const err = checkFK(fk)
          if (err) return { error: err }
          if (isDropped(changes, fk.refTable, fk.refSchema)) {
            addDep(qualifiedName(fk.refTable, fk.refSchema), key)
          }
        }
        break
      }

      case 'modify_table': {
        const key = qualifiedName(change.T.name, change.T.schema)
        ensureEntry(key)
        for (const c of change.changes) {
          switch (c.type) {
            case 'add_foreign_key': {
              const err = checkFK(c.F)
              if (err) return { error: err }
              if (c.F.refTable !== change.T.name || !sameSchema(c.F.refSchema, change.T.schema)) {
                addDep(key, qualifiedName(c.F.refTable, c.F.refSchema))
              }
              break
            }
            case 'modify_foreign_key': {
              const err = checkFK(c.to)
              if (err) return { error: err }
              if (c.to.refTable !== change.T.name || !sameSchema(c.to.refSchema, change.T.schema)) {
                addDep(key, qualifiedName(c.to.refTable, c.to.refSchema))
              }
              break
            }
            case 'drop_foreign_key': {
              const err = checkFK(c.F)
              if (err) return { error: err }
              if (isDropped(changes, c.F.refTable, c.F.refSchema)) {
                addDep(qualifiedName(c.F.refTable, c.F.refSchema), key)
              }
              break
            }
          }
        }
        break
      }
    }
  }

  return { deps }
}

/** Validate FK has required fields. */
function checkFK(fk: ForeignKey): string | undefined {
  const cause: string[] = []
  if (!fk.columns || fk.columns.length === 0) cause.push('child columns')
  if (!fk.refTable) cause.push('parent table')
  if (!fk.refColumns || fk.refColumns.length === 0) cause.push('parent columns')
  if (cause.length > 0) {
    return `missing [${cause.join(', ')}] for foreign key: "${fk.symbol ?? ''}"`
  }
  return undefined
}

/** Extract schema-qualified table name from a change (for sorting/keying). */
function tableName(change: Change): string {
  switch (change.type) {
    case 'add_table':
    case 'drop_table':
    case 'modify_table':
      return change.T.schema ? `${change.T.schema}.${change.T.name}` : change.T.name
    default:
      return ''
  }
}

/** Check if a table is being dropped in the changeset. */
function isDropped(changes: Change[], name: string, schema?: string): boolean {
  return changes.some((c) => c.type === 'drop_table' && c.T.name === name && sameSchema(c.T.schema, schema))
}

// -- SortChanges (main topological sort for all change types) --

/**
 * SortChanges is a helper function to sort top-level changes based on their priority.
 * Separates views and drops, builds dependency edges, does topological sort via DFS.
 *
 * Ported from Go: sql/internal/sqlx/plan.go:SortChanges
 */
export function sortChanges(changes: Change[]): Change[] {
  // Separate schema-level changes that must execute first (matches Go topLevel)
  const prelude: Change[] = []
  const views: Change[] = []
  const drop: Change[] = []
  const other: Change[] = []

  for (const c of changes) {
    switch (c.type) {
      case 'add_schema':
      case 'modify_schema':
        prelude.push(c)
        break
      case 'drop_schema':
        drop.push(c)
        break
      case 'add_object': {
        // Extensions must be created before tables/types (matches Go topLevel)
        const obj = (c as any).O
        if (obj?.name && obj?.version !== undefined) {
          prelude.push(c)
        } else {
          other.push(c)
        }
        break
      }
      case 'add_view':
      case 'drop_view':
      case 'modify_view':
        views.push(c)
        break
      case 'drop_table':
      case 'drop_func':
      case 'drop_proc':
      case 'drop_object':
        drop.push(c)
        break
      default:
        other.push(c)
        break
    }
  }

  // Sort views by dependency (Kahn's algorithm)
  const sortedViews = sortViewChanges(views)

  // To keep backwards compatibility: push views and drop changes to the end,
  // unless there is a dependency requirement.
  const ordered = [...other, ...sortedViews, ...drop]

  // Build dependency edges between all pairs
  const edgeSet = new Set<string>()
  const edges = new Map<Change, Change[]>()

  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++) {
      if (i === j) continue
      const c1 = ordered[i]
      const c2 = ordered[j]
      // Skip if the inverse dependency is already added (avoid circular)
      const inverseKey = `${j}:${i}`
      if (edgeSet.has(inverseKey)) continue

      if (dependsOn(c1, c2)) {
        const key = `${i}:${j}`
        if (!edgeSet.has(key)) {
          edgeSet.add(key)
          const existing = edges.get(c1) ?? []
          existing.push(c2)
          edges.set(c1, existing)
        }
      }
    }
  }

  // Topological sort via DFS
  const added = new Set<Change>()
  const planned: Change[] = []

  function add(c: Change) {
    if (added.has(c)) return
    added.add(c)
    for (const dep of edges.get(c) ?? []) {
      if (!added.has(dep)) {
        add(dep)
      }
    }
    planned.push(c)
  }

  for (const c of ordered) {
    if (!added.has(c)) {
      add(c)
    }
  }

  // Prelude (schemas) goes first, then sorted changes
  return [...prelude, ...planned]
}

// -- sortViewChanges (Kahn's topological sort for view changes) --

/**
 * Kahn's topological sort for view changes based on view deps.
 *
 * Ported from Go: sql/internal/sqlx/sqlx_oss.go:sortViewChanges
 */
function sortViewChanges(changes: Change[]): Change[] {
  if (changes.length <= 1) return changes

  // Build a map of view name -> change
  const byName = new Map<string, Change>()
  for (const c of changes) {
    switch (c.type) {
      case 'add_view':
        byName.set(viewKey(c.V), c)
        break
      case 'drop_view':
        byName.set(viewKey(c.V), c)
        break
      case 'modify_view':
        byName.set(viewKey(c.to), c)
        break
    }
  }

  // deps[c] = list of changes that must come before c
  const deps = new Map<Change, Change[]>()

  for (const c of changes) {
    switch (c.type) {
      case 'add_view': {
        for (const d of c.V.deps ?? []) {
          if (d.type === 'view') {
            const dep = byName.get(refKey(d))
            if (dep && dep !== c) {
              const list = deps.get(c) ?? []
              list.push(dep)
              deps.set(c, list)
            }
          }
        }
        break
      }
      case 'modify_view': {
        for (const d of c.to.deps ?? []) {
          if (d.type === 'view') {
            const dep = byName.get(refKey(d))
            if (dep && dep !== c) {
              const list = deps.get(c) ?? []
              list.push(dep)
              deps.set(c, list)
            }
          }
        }
        break
      }
      case 'drop_view': {
        // Drop order is reversed: if v1 depends on v2, drop v1 first.
        for (const other of changes) {
          if (other === c) continue
          if (other.type === 'drop_view') {
            for (const d of other.V.deps ?? []) {
              if (d.type === 'view' && d.name === c.V.name && sameSchema(d.schema, c.V.schema)) {
                const list = deps.get(c) ?? []
                list.push(other)
                deps.set(c, list)
              }
            }
          }
        }
        break
      }
    }
  }

  // Kahn's topological sort
  const inDeg = new Map<Change, number>()
  for (const c of changes) {
    inDeg.set(c, (deps.get(c) ?? []).length)
  }

  const queue: Change[] = []
  for (const c of changes) {
    if ((inDeg.get(c) ?? 0) === 0) {
      queue.push(c)
    }
  }

  const sorted: Change[] = []
  while (queue.length > 0) {
    const c = queue.shift()!
    sorted.push(c)
    for (const [other, ds] of deps) {
      if (ds.includes(c)) {
        inDeg.set(other, (inDeg.get(other) ?? 1) - 1)
        if (inDeg.get(other) === 0) {
          queue.push(other)
        }
      }
    }
  }

  // If cycle detected, return original order
  if (sorted.length !== changes.length) {
    return changes
  }

  return sorted
}

/** Create a key for a view (name + schema). */
function viewKey(v: View): string {
  return v.schema ? `${v.schema}.${v.name}` : v.name
}

/** Create a key from an ObjectRef. */
function refKey(ref: ObjectRef): string {
  return ref.schema ? `${ref.schema}.${ref.name}` : ref.name
}

// -- dependsOn --

/**
 * Reports if c1 depends on c2 (i.e. c2 must come before c1).
 *
 * Ported from Go: sql/internal/sqlx/sqlx_oss.go:dependsOn
 * Handles ALL change type pairs: AddTable->AddTable (FK refs), AddTable->AddObject (type deps),
 * DropTable->DropTable (reverse refs), ModifyTable->AddTable, views, funcs, procs, triggers, objects, schemas.
 */
export function dependsOn(c1: Change, c2: Change): boolean {
  switch (c1.type) {
    case 'drop_schema': {
      if (c2.type === 'drop_table') {
        // Schema must be dropped after all its tables and references to them.
        if (sameSchema(c1.S.name, c2.T.schema)) return true
        // Also depends if any FK on the dropped table references something in this schema
        if ((c2.T.foreignKeys ?? []).some((fk) => sameSchema(c1.S.name, fk.refSchema))) return true
      }
      if (c2.type === 'modify_table') {
        if (sameSchema(c1.S.name, c2.T.schema)) return true
        if (c2.changes.some((c) => c.type === 'drop_foreign_key' && sameSchema(c1.S.name, c.F.refSchema))) return true
      }
      return false
    }

    case 'add_table': {
      switch (c2.type) {
        case 'add_schema':
          // Table creation depends on schema creation
          return c1.T.schema === c2.S.name

        case 'drop_table':
          // Table recreation: same name+schema
          return c1.T.name === c2.T.name && sameSchema(c1.T.schema, c2.T.schema)

        case 'add_table':
          // FK reference: this table has FK pointing to c2's table
          if (refTo(c1.T.foreignKeys, c2.T)) return true
          // Column type depends on c2's table (e.g. row types) — not applicable in TS string-based types
          return false

        case 'modify_table':
          // Different table, but this table has FK referencing c2's table
          if ((c1.T.name !== c2.T.name || !sameSchema(c1.T.schema, c2.T.schema)) && refTo(c1.T.foreignKeys, c2.T)) {
            return true
          }
          return false

        case 'add_object': {
          // Table columns depend on a type being added (e.g. enum, domain, composite)
          const obj = c2.O as any
          if (!obj) return false
          const objName = obj.T || obj.name || ''
          const objSchema = obj.schema
          // Check if any column's type references this object
          return (c1.T.columns ?? []).some((col) => {
            const ct = col.type?.type
            if (!ct) return false
            // Direct match: column type T matches object name
            if (ct.T === objName && (!objSchema || (ct as any).schema === objSchema)) return true
            // Qualified match: column type T is schema.name
            if (objSchema && ct.T === `${objSchema}.${objName}`) return true
            // Match raw type name
            if (col.type?.raw === objName || col.type?.raw === `${objSchema}.${objName}`) return true
            // Array inner type
            if (ct.kind === 'array' && ct.type) {
              const inner = ct.type as any
              if (inner.T === objName) return true
              if (objSchema && inner.T === `${objSchema}.${objName}`) return true
            }
            // Column default references a sequence (nextval('schema.seqname'))
            if (col.default) {
              const expr = ('X' in col.default ? col.default.X : '') || ''
              const qualName = objSchema ? `${objSchema}.${objName}` : objName
              if (expr.includes(`nextval('${qualName}'`) || expr.includes(`nextval('${objName}'`)) return true
            }
            return false
          })
        }
        case 'add_func': {
          // Table column defaults may reference functions (e.g. DEFAULT current_user_id())
          const funcName = c2.F.name
          const funcSchema = c2.F.schema
          return (c1.T.columns ?? []).some((col) => {
            const dflt = col.default
            if (!dflt) return false
            const expr = ('X' in dflt ? dflt.X : '') || ''
            // Check if default expression references this function
            if (funcSchema) {
              if (expr.includes(`${funcSchema}.${funcName}(`)) return true
            }
            if (expr.includes(`${funcName}(`)) return true
            return false
          })
        }
        case 'add_sequence': {
          // Table column defaults may reference sequences (nextval('seq'))
          const seqName = c2.S.name
          const seqSchema = c2.S.schema
          return (c1.T.columns ?? []).some((col) => {
            if (!col.default) return false
            const expr = ('X' in col.default ? col.default.X : '') || ''
            const qualName = seqSchema ? `${seqSchema}.${seqName}` : seqName
            return expr.includes(`nextval('${qualName}'`) || expr.includes(`nextval('${seqName}'`)
          })
        }
      }
      // Check if c2 creates something in this table's deps
      return depOfAdd(c1.T.deps, c2)
    }

    case 'drop_table': {
      // Drop of a table must occur after all resources that rely on it are dropped.
      switch (c2.type) {
        case 'drop_table':
          // References to this table must be dropped first.
          if (refTo(c2.T.foreignKeys, c1.T)) return true
          return false

        case 'modify_table':
          // ModifyTable that drops FKs referencing this table must happen first.
          if (
            c2.changes.some((c) => {
              if (c.type === 'drop_foreign_key') {
                return fkRefsTable(c.F, c1.T.name, c1.T.schema)
              }
              return false
            })
          )
            return true
          return false
      }
      // Check deps: does c2 drop something that depends on this table?
      return depOfDrop({ type: 'table', name: c1.T.name, schema: c1.T.schema }, c1.T.deps, c1.T.triggers, c2)
    }

    case 'modify_table': {
      switch (c2.type) {
        case 'add_table':
          // Table modification relies on its creation.
          if (c1.T.name === c2.T.name && sameSchema(c1.T.schema, c2.T.schema)) return true
          // Tables need to be created before referencing them via FK.
          if (
            c1.changes.some((c) => {
              if (c.type === 'add_foreign_key') {
                return fkRefsTable(c.F, c2.T.name, c2.T.schema)
              }
              return false
            })
          )
            return true
          return false

        case 'modify_table':
          // Different table: check if c1 adds FK referencing c2's table with new columns
          if (c1.T.name !== c2.T.name || !sameSchema(c1.T.schema, c2.T.schema)) {
            const addCols = new Set<string>()
            for (const c of c2.changes) {
              if (c.type === 'add_column') {
                addCols.add(c.C.name)
              }
            }
            return c1.changes.some((c) => {
              if (c.type !== 'add_foreign_key') return false
              if (!fkRefsTable(c.F, c2.T.name, c2.T.schema)) return false
              return c.F.columns.some((col) => addCols.has(col))
            })
          }
          return false

        case 'add_object':
          // Type creation dependency — not applicable in TS string-based types
          return false
      }
      return depOfAdd(c1.T.deps, c2)
    }

    case 'add_view':
      if (c2.type === 'add_schema' && c1.V.schema === c2.S.name) return true
      return depOfAdd(c1.V.deps, c2)

    case 'drop_view':
      return depOfDropView(c1.V, c2)

    case 'add_func':
      if (c2.type === 'add_schema' && c1.F.schema === c2.S.name) return true
      return depOfAdd(c1.F.deps, c2)

    case 'drop_func':
      return depOfDropSimple({ type: 'func', name: c1.F.name, schema: c1.F.schema }, c1.F.deps, c2)

    case 'add_proc':
      if (c2.type === 'add_schema' && c1.P.schema === c2.S.name) return true
      return depOfAdd(c1.P.deps, c2)

    case 'drop_proc':
      return depOfDropSimple({ type: 'proc', name: c1.P.name, schema: c1.P.schema }, c1.P.deps, c2)

    case 'add_trigger': {
      const trig = c1.T
      // Trigger depends on its table existing — match by structural fields
      if (c2.type === 'add_table') {
        if (trig.table === c2.T.name && (trig.schema ?? '') === (c2.T.schema ?? '')) return true
      }
      if (c2.type === 'add_schema') {
        if ((trig.schema ?? '') === c2.S.name) return true
      }
      if (c2.type === 'add_func') {
        if (trig.funcName === c2.F.name && (trig.funcSchema ?? '') === (c2.F.schema ?? '')) return true
      }
      return depOfAdd(trig.deps, c2)
    }

    case 'drop_trigger':
      return depOfDropSimple({ type: 'trigger', name: c1.T.name, schema: undefined }, c1.T.deps, c2)

    case 'drop_object': {
      // Dropping an object (e.g. enum type) must occur after all its usages are dropped.
      // In Go this checks columns for type usage — with TS string-based types, we can
      // check if the dropped object appears in deps of the other change's subject.
      switch (c2.type) {
        case 'drop_table':
          // Check if any trigger on the dropped table depends on this object
          if (
            (c2.T.triggers ?? []).some((tg) =>
              depsContain(tg.deps, {
                type: 'table',
                name: ((c1 as DropObject).O?.name as string) ?? '',
                schema: undefined,
              }),
            )
          )
            return true
          return false

        case 'modify_table':
          // A modify that drops columns using this type must happen first
          return false
      }
      return false
    }

    case 'add_object': {
      // Schema dependency for objects (enums, domains, composites, etc.)
      if (c2.type === 'add_schema') {
        const obj = c1.O as any
        if (obj?.schema === c2.S.name) return true
      }
      // Composite type fields may reference other types (enums, domains)
      if (c2.type === 'add_object') {
        const obj1 = c1.O as any
        const obj2 = c2.O as any
        if (obj1?.kind === 'composite' && obj2) {
          const obj2Name = obj2.T || obj2.name || ''
          const obj2Schema = obj2.schema
          const fields = obj1.fields ?? obj1.compositeFields ?? []
          for (const f of fields) {
            const fType = f.type?.T || ''
            // Check if field type matches obj2 (qualified or unqualified)
            if (fType === obj2Name || fType === `${obj2Schema}.${obj2Name}`) return true
          }
        }
      }
      // An AddObject may have deps (e.g., aggregate depends on its state function).
      const obj = c1.O as any
      if (obj?.deps && Array.isArray(obj.deps)) {
        return depOfAdd(obj.deps, c2)
      }
      return false
    }
  }

  return false
}

// -- depOfAdd --

/**
 * Checks if the given change is a creation of a resource that exists in the given refs list.
 *
 * Ported from Go: sql/internal/sqlx/plan.go:depOfAdd
 */
function depOfAdd(refs: ObjectRef[] | undefined, c: Change): boolean {
  if (!refs || refs.length === 0) return false

  switch (c.type) {
    case 'add_table':
      return refs.some((ref) => refMatchesTable(ref, c.T))

    case 'modify_table':
      return refs.some((ref) => refMatchesTable(ref, c.T))

    case 'add_view':
      return refs.some((ref) => refMatchesView(ref, c.V))

    case 'modify_view':
      return refs.some((ref) => refMatchesView(ref, c.to))

    case 'add_object': {
      // Match object by kind+name against refs (enum, compositeType, domainType, etc.)
      const obj = c.O as any
      if (!obj) return false
      const objName = obj.T || obj.name || ''
      const objSchema = obj.schema
      return refs.some((ref) => {
        if (ref.name !== objName) return false
        if (objSchema && ref.schema && ref.schema !== objSchema) return false
        return true
      })
    }

    case 'add_trigger':
      return refs.some((ref) => ref.type === 'trigger' && ref.name === c.T.name)

    case 'add_func':
      return refs.some((ref) => refMatchesFunc(ref, c.F))

    case 'add_proc':
      return refs.some((ref) => refMatchesProc(ref, c.P))

    default:
      return false
  }
}

// -- depOfDrop (for tables — has triggers) --

/**
 * Checks if the object being dropped is depended on by c2.
 * Handles triggers that may have their own deps.
 *
 * Ported from Go: sql/internal/sqlx/plan.go:depOfDrop
 */
function depOfDrop(
  _selfRef: ObjectRef,
  selfDeps: ObjectRef[] | undefined,
  triggers: Trigger[] | undefined,
  c: Change,
): boolean {
  // Collect all deps from the object and its triggers
  const allDeps: ObjectRef[] = [...(selfDeps ?? [])]
  for (const tg of triggers ?? []) {
    for (const d of tg.deps ?? []) {
      // If the trigger depends on a table that has FK to its parent,
      // this dependency should be ignored as the FK needs to be dropped first.
      // (This is a simplification — in Go it checks refTo with pointer equality)
      allDeps.push(d)
    }
  }

  return depsContainChange(allDeps, c)
}

/** Checks if the dropped view is depended on by c2. */
function depOfDropView(v: View, c: Change): boolean {
  const allDeps: ObjectRef[] = [...(v.deps ?? [])]
  return depsContainChange(allDeps, c)
}

/** Checks if the dropped func/proc/trigger is depended on by c2. */
function depOfDropSimple(_selfRef: ObjectRef, selfDeps: ObjectRef[] | undefined, c: Change): boolean {
  return depsContainChange(selfDeps ?? [], c)
}

/**
 * Check if any dep in the list matches the subject of the given change (for drop ordering).
 * When dropping an object X that depends on Y, Y must be dropped after X.
 * So if c2 drops Y, and X depends on Y, then dropping X depends on dropping Y? No —
 * Actually for drops: if X depends on Y, then Y must be dropped AFTER X.
 * So DropX depends on DropY being NOT done yet... which means DropY should come after DropX.
 *
 * The Go code uses depOfDrop to check: "does the thing being dropped (c1) have
 * this object (from c2) in its deps?" If c2 drops something, and that something
 * appears in c1's deps, then c1 must happen first (before c2).
 */
function depsContainChange(deps: ObjectRef[], c: Change): boolean {
  if (deps.length === 0) return false

  switch (c.type) {
    case 'drop_table':
      return deps.some((d) => refMatchesTable(d, c.T))
    case 'drop_view':
      return deps.some((d) => refMatchesView(d, c.V))
    case 'drop_func':
      return deps.some((d) => refMatchesFunc(d, c.F))
    case 'drop_proc':
      return deps.some((d) => refMatchesProc(d, c.P))
    case 'drop_trigger':
      return deps.some((d) => d.type === 'trigger' && d.name === c.T.name)
    default:
      return false
  }
}

// -- Plan Engine --

/**
 * Convert a list of Changes into executable SQL Plans.
 * Uses a PlanDriver for dialect-specific SQL generation.
 * Applies detachCycles and sortChanges before generating SQL.
 */
export function planChanges(_driver: PlanDriver, changes: Change[], opts?: PlanOptions): Plan[] {
  // Step 1: Detach FK cycles
  let planned = detachCycles(changes)

  // Step 2: Sort by dependency
  planned = sortChanges(planned)

  // Group all changes into a single plan
  const plan: Plan = {
    changes: planned,
    transactional: opts?.transactional,
  }

  return [plan]
}

/**
 * Generate SQL statements for a single change.
 * Returns an array of SQL strings.
 */
export function changeToSQL(driver: PlanDriver, change: Change): string[] {
  switch (change.type) {
    case 'add_schema':
      return driver.addSchema?.(change.S) ?? []

    case 'drop_schema':
      return driver.dropSchema?.(change.S, change.extra) ?? []

    case 'add_table':
      return driver.addTable(change.T)

    case 'drop_table':
      return driver.dropTable(change.T, change.extra)

    case 'modify_table':
      return driver.modifyTable(change.T, change.T, change.changes)

    case 'add_view':
      return driver.addView?.(change.V) ?? []

    case 'drop_view':
      return driver.dropView?.(change.V, change.extra) ?? []

    case 'modify_view':
      return driver.modifyView?.(change.from, change.to) ?? []

    case 'add_func':
      return driver.addFunc?.(change.F) ?? []

    case 'drop_func':
      return driver.dropFunc?.(change.F, change.extra) ?? []

    case 'modify_func':
      if (driver.modifyFunc) {
        return driver.modifyFunc(change.from, change.to, change.changes ?? [])
      }
      if (driver.dropFunc && driver.addFunc) {
        return [...driver.dropFunc(change.from), ...driver.addFunc(change.to)]
      }
      throw new Error('modify_func is not supported by this plan driver')

    case 'add_trigger':
      return driver.addTrigger?.(change.T) ?? []

    case 'drop_trigger':
      return driver.dropTrigger?.(change.T, change.extra) ?? []

    case 'add_sequence':
      return driver.addSequence?.(change.S) ?? []

    case 'drop_sequence':
      return driver.dropSequence?.(change.S, change.extra) ?? []

    case 'modify_sequence':
      return driver.modifySequence?.(change.from, change.to) ?? []

    case 'add_object':
      return driver.addObject?.(change.O) ?? []

    case 'drop_object':
      return driver.dropObject?.(change.O, change.extra) ?? []

    case 'modify_object':
      if (driver.dropObject && driver.addObject) {
        return [...driver.dropObject((change as any).from), ...driver.addObject((change as any).to)]
      }
      throw new Error('modify_object is not supported by this plan driver')

    case 'add_proc':
      return driver.addProc?.(change.P) ?? []

    case 'drop_proc':
      return driver.dropProc?.(change.P, change.extra) ?? []

    case 'modify_proc':
      if (driver.modifyProc) {
        return driver.modifyProc(change.from, change.to, change.changes ?? [])
      }
      if (driver.dropProc && driver.addProc) {
        return [...driver.dropProc(change.from), ...driver.addProc(change.to)]
      }
      throw new Error('modify_proc is not supported by this plan driver')

    default:
      return []
  }
}

/**
 * Apply error that exposes how many changes were applied before failure.
 */
export class ApplyError extends Error {
  readonly applied: number

  constructor(message: string, applied: number) {
    super(message)
    this.name = 'ApplyError'
    this.applied = applied
  }
}
