-- Included table: part of the pet store project, managed by migrations.
-- Also references the same external locations table (tests deduplication).

-- @external '../external/locations.sql'

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL REFERENCES pets(id),
  owner_id INTEGER NOT NULL REFERENCES owners(id),
  rating INTEGER NOT NULL,
  body TEXT,
  location_id INTEGER REFERENCES locations(id),
  created_at TEXT DEFAULT (datetime('now'))
);
