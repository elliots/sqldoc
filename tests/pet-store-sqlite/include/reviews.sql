-- Included table: part of the pet store project, managed by migrations.
-- Also references the same external locations table (tests deduplication).

-- @external '../external/locations.sql'

-- @import '@sqldoc/ns-validate'

-- @docs.description('Customer reviews for pets')
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL REFERENCES pets(id),
  owner_id INTEGER NOT NULL REFERENCES owners(id),
  -- @validate.range(min: 1, max: 5)
  rating INTEGER NOT NULL,
  body TEXT,
  location_id INTEGER REFERENCES locations(id),
  created_at TEXT DEFAULT (datetime('now'))
);
