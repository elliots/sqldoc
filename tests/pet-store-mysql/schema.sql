-- Pet Store schema (MySQL dialect)
-- Exercises portable namespace plugins (no Postgres-only: rls, anon, postgraphile)

-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-codegen'
-- @import '@sqldoc/ns-comment'
-- @import '@sqldoc/ns-deprecated'
-- @import '@sqldoc/ns-docs'
-- @import '@sqldoc/ns-lint'
-- @import '@sqldoc/ns-validate'
-- @import './custom-plugin.ts'

-- ── 1. categories ────────────────────────────────────────────────────

-- @comment('Pet categories lookup table')
-- @docs.description('Lookup table for pet species and breed categories')
CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- @comment('Category display name')
  -- @validate.notEmpty
  name VARCHAR(100) NOT NULL,
  description TEXT
);

-- ── 2. pets ──────────────────────────────────────────────────────────

-- @comment('Core pet inventory table')
-- @docs.description('Central registry of all pets available for adoption')
CREATE TABLE pets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT,
  -- @validate.notEmpty
  name VARCHAR(100) NOT NULL,
  -- @validate.pattern('^[A-Z]{3}-[0-9]{4}$')
  sku VARCHAR(20) NOT NULL UNIQUE,
  -- @validate.range(min: 0, max: 99999)
  price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  internal_notes TEXT,
  -- @codegen.rename('petStatus')
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- ── 3. owners ────────────────────────────────────────────────────────

-- @comment('Pet owners and customers')
CREATE TABLE owners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- @validate.notEmpty
  name VARCHAR(150) NOT NULL,
  -- @validate.pattern('^[^@]+@[^@]+\\.[^@]+$')
  email VARCHAR(255) NOT NULL UNIQUE,
  -- @validate.length(min: 7, max: 20)
  phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 4. adoptions ─────────────────────────────────────────────────────

-- @comment('Adoption records linking pets to owners')
-- @audit
-- @custom
-- @docs.description('Tracks each adoption event with timestamps and fees')
CREATE TABLE adoptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pet_id INT NOT NULL,
  owner_id INT NOT NULL,
  -- @comment('Timestamp when the adoption was finalized')
  adopted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  adoption_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
  FOREIGN KEY (pet_id) REFERENCES pets(id),
  FOREIGN KEY (owner_id) REFERENCES owners(id)
);

-- ── 5. medical_records ───────────────────────────────────────────────

-- @comment('Veterinary medical records for pets')
CREATE TABLE medical_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pet_id INT NOT NULL,
  visit_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  diagnosis TEXT NOT NULL,
  treatment TEXT,
  vet_name VARCHAR(150),
  FOREIGN KEY (pet_id) REFERENCES pets(id)
);

-- ── 6. legacy_inventory ──────────────────────────────────────────────

-- @deprecated.replace('pets')
-- @lint.ignore('audit.require-audit', 'Legacy table scheduled for removal')
-- @docs.emit(false)
CREATE TABLE legacy_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_name VARCHAR(200),
  -- @deprecated.remove('2025-12-01')
  old_sku VARCHAR(50),
  quantity INT DEFAULT 0
);

-- ── 7. staff ─────────────────────────────────────────────────────────

-- @comment('Internal staff members')
-- @codegen.skip
-- @audit
CREATE TABLE staff (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'associate',
  hired_at DATE NOT NULL DEFAULT (CURRENT_DATE)
);
