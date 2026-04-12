-- Pet Store schema (MSSQL dialect)
-- Exercises portable namespace plugins (no Postgres-only: rls, anon, postgraphile)

-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-codegen'
-- @import '@sqldoc/ns-comment'
-- @import '@sqldoc/ns-deprecated'
-- @import '@sqldoc/ns-docs'
-- @import '@sqldoc/ns-lint'
-- @import '@sqldoc/ns-validate'
-- @import './custom-plugin.ts'
-- @external './external/locations.sql'
-- @include './include/reviews.sql'

-- 1. categories

-- @comment('Pet categories lookup table')
-- @docs.description('Lookup table for pet species and breed categories')
CREATE TABLE categories (
  id INT IDENTITY(1,1) PRIMARY KEY,
  -- @comment('Category display name')
  -- @validate.notEmpty
  name NVARCHAR(100) NOT NULL,
  description NVARCHAR(MAX)
);

-- 2. pets

-- @comment('Core pet inventory table')
-- @docs.description('Central registry of all pets available for adoption')
CREATE TABLE pets (
  id INT IDENTITY(1,1) PRIMARY KEY,
  category_id INT,
  -- @validate.notEmpty
  name NVARCHAR(100) NOT NULL,
  sku NVARCHAR(20) NOT NULL UNIQUE,
  -- @validate.range(min: 0, max: 99999)
  price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  internal_notes NVARCHAR(MAX),
  -- @codegen.rename('petStatus')
  status NVARCHAR(20) NOT NULL DEFAULT 'available',
  created_at DATETIME2 DEFAULT GETDATE(),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- 3. owners

-- @comment('Pet owners and customers')
CREATE TABLE owners (
  id INT IDENTITY(1,1) PRIMARY KEY,
  -- @validate.notEmpty
  name NVARCHAR(150) NOT NULL,
  email NVARCHAR(255) NOT NULL UNIQUE,
  -- @validate.length(min: 7, max: 20)
  phone NVARCHAR(20),
  created_at DATETIME2 DEFAULT GETDATE()
);

-- 4. adoptions

-- @comment('Adoption records linking pets to owners')
-- @audit
-- @custom
-- @docs.description('Tracks each adoption event with timestamps and fees')
CREATE TABLE adoptions (
  id INT IDENTITY(1,1) PRIMARY KEY,
  pet_id INT NOT NULL,
  owner_id INT NOT NULL,
  -- @comment('Timestamp when the adoption was finalized')
  adopted_at DATETIME2 NOT NULL DEFAULT GETDATE(),
  adoption_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
  FOREIGN KEY (pet_id) REFERENCES pets(id),
  FOREIGN KEY (owner_id) REFERENCES owners(id)
);

-- 5. medical_records

-- @comment('Veterinary medical records for pets')
CREATE TABLE medical_records (
  id INT IDENTITY(1,1) PRIMARY KEY,
  pet_id INT NOT NULL,
  visit_date DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE),
  diagnosis NVARCHAR(MAX) NOT NULL,
  treatment NVARCHAR(MAX),
  vet_name NVARCHAR(150),
  FOREIGN KEY (pet_id) REFERENCES pets(id)
);

-- 6. legacy_inventory

-- @deprecated.replace('pets')
-- @lint.ignore('audit.require-audit', 'Legacy table scheduled for removal')
-- @docs.emit(false)
CREATE TABLE legacy_inventory (
  id INT IDENTITY(1,1) PRIMARY KEY,
  item_name NVARCHAR(200),
  -- @deprecated.remove('2025-12-01')
  old_sku NVARCHAR(50),
  quantity INT DEFAULT 0
);

-- 7. staff

-- @comment('Internal staff members')
-- @codegen.skip
-- @audit
CREATE TABLE staff (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(150) NOT NULL,
  role NVARCHAR(50) NOT NULL DEFAULT 'associate',
  hired_at DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE)
);

-- ── 8. stored procedure ─────────────────────────────────────────────
GO
CREATE PROCEDURE get_adoption_report
  @p_owner_id INT = NULL
AS
BEGIN
  SET NOCOUNT ON
  SELECT
    p.name AS pet_name,
    o.name AS owner_name,
    a.adopted_at,
    a.adoption_fee,
    c.name AS category_name
  FROM adoptions a
  JOIN pets p ON p.id = a.pet_id
  JOIN owners o ON o.id = a.owner_id
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE @p_owner_id IS NULL OR o.id = @p_owner_id
END
