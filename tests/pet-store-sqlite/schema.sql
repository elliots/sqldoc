-- Pet Store schema (SQLite dialect)
-- Exercises SQLite-compatible plugins (no: rls, anon, postgraphile, comment, deprecated, validate, audit, docs)

-- @import '@sqldoc/ns-codegen'
-- @import '@sqldoc/ns-lint'
-- @import './custom-plugin.ts'
-- @external './external/locations.sql'
-- @include './include/reviews.sql'

-- ── 1. categories ────────────────────────────────────────────────────

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT
);

-- ── 2. pets ──────────────────────────────────────────────────────────

CREATE TABLE pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  price REAL NOT NULL DEFAULT 0,
  internal_notes TEXT,
  -- @codegen.rename('petStatus')
  status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 3. owners ────────────────────────────────────────────────────────

CREATE TABLE owners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 4. adoptions ─────────────────────────────────────────────────────

-- @custom
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
CREATE TABLE legacy_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_name TEXT,
  old_sku TEXT,
  quantity INTEGER DEFAULT 0
);

-- ── 7. staff ─────────────────────────────────────────────────────────

-- @codegen.skip
CREATE TABLE staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'associate',
  hired_at TEXT NOT NULL DEFAULT (date('now'))
);
