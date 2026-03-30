-- Pet Store schema (SQLite dialect)
-- Exercises SQLite-compatible plugins (no: rls, anon, postgraphile, comment, deprecated)

-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-codegen'
-- @import '@sqldoc/ns-docs'
-- @import '@sqldoc/ns-lint'
-- @import '@sqldoc/ns-validate'
-- @import './custom-plugin.ts'
-- @external './external/locations.sql'
-- @include './include/reviews.sql'

-- ── 1. categories ────────────────────────────────────────────────────

-- @docs.description('Lookup table for pet species and breed categories')
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- @validate.notEmpty
  name TEXT NOT NULL,
  description TEXT
);

-- ── 2. pets ──────────────────────────────────────────────────────────

-- @docs.description('Central registry of all pets available for adoption')
CREATE TABLE pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id),
  -- @validate.notEmpty
  name TEXT NOT NULL,
  -- @validate.pattern('^[A-Z]{3}-[0-9]{4}$')
  sku TEXT NOT NULL UNIQUE,
  -- @validate.range(min: 0, max: 99999)
  price REAL NOT NULL DEFAULT 0,
  internal_notes TEXT,
  -- @codegen.rename('petStatus')
  status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 3. owners ────────────────────────────────────────────────────────

CREATE TABLE owners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- @validate.notEmpty
  name TEXT NOT NULL,
  -- @validate.pattern('^[^@]+@[^@]+\.[^@]+$')
  email TEXT NOT NULL UNIQUE,
  -- @validate.length(min: 7, max: 20)
  phone TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 4. adoptions ─────────────────────────────────────────────────────

-- @audit
-- @custom
-- @docs.description('Tracks each adoption event with timestamps and fees')
CREATE TABLE adoptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL REFERENCES pets(id),
  owner_id INTEGER NOT NULL REFERENCES owners(id),
  adopted_at TEXT NOT NULL DEFAULT (datetime('now')),
  adoption_fee REAL NOT NULL DEFAULT 0
);

-- ── 5. medical_records ───────────────────────────────────────────────

CREATE TABLE medical_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL REFERENCES pets(id),
  visit_date TEXT NOT NULL DEFAULT (date('now')),
  diagnosis TEXT NOT NULL,
  treatment TEXT,
  vet_name TEXT
);

-- ── 6. legacy_inventory ──────────────────────────────────────────────

-- @lint.ignore('audit.require-audit', 'Legacy table scheduled for removal')
-- @docs.emit(false)
CREATE TABLE legacy_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_name TEXT,
  old_sku TEXT,
  quantity INTEGER DEFAULT 0
);

-- ── 7. staff ─────────────────────────────────────────────────────────

-- @codegen.skip
-- @audit
CREATE TABLE staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'associate',
  hired_at TEXT NOT NULL DEFAULT (date('now'))
);
