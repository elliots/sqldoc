-- Included table: part of the pet store project, managed by migrations.
-- Also references the same external locations table (tests deduplication).

-- @external '../external/locations.sql'

-- @import '@sqldoc/ns-validate'
-- @import '@sqldoc/ns-comment'

-- @comment('Customer reviews for pets')
CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  -- @validate.range(min: 1, max: 5)
  rating INTEGER NOT NULL,
  body TEXT,
  location_id INTEGER REFERENCES locations(id),
  created_at TIMESTAMP DEFAULT NOW()
);
