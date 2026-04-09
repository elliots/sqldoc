-- Pet Store schema: exercises all 10 namespace plugins + 1 custom local plugin
--
-- This schema defines a realistic pet store database with 7 tables,
-- each decorated with tags from multiple namespaces to verify that
-- all plugins work together without conflict.

-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-codegen'
-- @import '@sqldoc/ns-comment'
-- @import '@sqldoc/ns-deprecated'
-- @import '@sqldoc/ns-docs'
-- @import '@sqldoc/ns-lint'
-- @import '@sqldoc/ns-postgraphile'
-- @import '@sqldoc/ns-rls'
-- @import '@sqldoc/ns-validate'
-- @import './custom-plugin.ts'

-- @external './external/locations.sql'
-- @include './include/reviews.sql'

-- ── 1. categories ────────────────────────────────────────────────────

-- @comment('Pet categories lookup table')
-- @pg.simpleCollections
-- @docs.description('Lookup table for pet species and breed categories')
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  -- @comment('Category display name')
  -- @validate.notEmpty
  name VARCHAR(100) NOT NULL,
  description TEXT
);

-- ── 2. pets ──────────────────────────────────────────────────────────

-- @comment('Core pet inventory table')
-- @rls
-- @rls.policy(for: SELECT, to: PUBLIC, using: 'true')
-- @docs.description('Central registry of all pets available for adoption')
CREATE TABLE pets (
  id SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id),
  -- @validate.notEmpty
  name VARCHAR(100) NOT NULL,
  -- @validate.pattern('^[A-Z]{3}-[0-9]{4}$')
  sku VARCHAR(20) NOT NULL UNIQUE,
  -- @validate.range(min: 0, max: 99999)
  price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  internal_notes TEXT,
  -- @codegen.rename('petStatus')
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── 3. owners ────────────────────────────────────────────────────────

-- @comment('Pet owners and customers')
-- @rls
-- @rls.policy(for: ALL, to: PUBLIC, using: 'true')
-- @pg.name('Customer')
CREATE TABLE owners (
  id SERIAL PRIMARY KEY,
  -- @validate.notEmpty
  name VARCHAR(150) NOT NULL,
  -- @validate.pattern('^[^@]+@[^@]+\.[^@]+$')
  email VARCHAR(255) NOT NULL UNIQUE,
  -- @validate.length(min: 7, max: 20)
  phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── 4. adoptions ─────────────────────────────────────────────────────

-- @comment('Adoption records linking pets to owners')
-- @audit
-- @custom
-- @docs.description('Tracks each adoption event with timestamps and fees')
CREATE TABLE adoptions (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL REFERENCES pets(id),
  owner_id INTEGER NOT NULL REFERENCES owners(id),
  -- @comment('Timestamp when the adoption was finalized')
  adopted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  adoption_fee NUMERIC(10, 2) NOT NULL DEFAULT 0
);

-- ── 5. medical_records ───────────────────────────────────────────────

-- @comment('Veterinary medical records for pets')
-- @rls
-- @rls.policy(for: SELECT, to: PUBLIC, using: 'true')
CREATE TABLE medical_records (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL REFERENCES pets(id),
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  diagnosis TEXT NOT NULL,
  treatment TEXT,
  vet_name VARCHAR(150)
);

-- ── 6. legacy_inventory ──────────────────────────────────────────────

-- @deprecated.replace('pets')
-- @lint.ignore('audit.require-audit', 'Legacy table scheduled for removal')
-- @docs.emit(false)
CREATE TABLE legacy_inventory (
  id SERIAL PRIMARY KEY,
  item_name VARCHAR(200),
  -- @deprecated.remove('2025-12-01')
  old_sku VARCHAR(50),
  quantity INTEGER DEFAULT 0
);

-- ── 7. staff ─────────────────────────────────────────────────────────

-- @comment('Internal staff members')
-- @pg.omit
-- @codegen.skip
-- @audit
CREATE TABLE staff (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'associate',
  hired_at DATE NOT NULL DEFAULT CURRENT_DATE
);

-- ── Composite return type (only used by function, not in any column) ──

CREATE TYPE adoption_report AS (
  pet_name VARCHAR(100),
  owner_name VARCHAR(150),
  adopted_at TIMESTAMP,
  adoption_fee NUMERIC(10,2),
  category_name VARCHAR(100)
);

CREATE FUNCTION get_adoption_report(p_owner_id INTEGER DEFAULT NULL) RETURNS SETOF adoption_report
  LANGUAGE sql STABLE AS $$
  SELECT p.name, o.name, a.adopted_at, a.adoption_fee, c.name
  FROM adoptions a
  JOIN pets p ON p.id = a.pet_id
  JOIN owners o ON o.id = a.owner_id
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE p_owner_id IS NULL OR o.id = p_owner_id;
$$;
