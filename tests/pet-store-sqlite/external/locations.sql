-- External table: pre-existing "locations" service schema
-- This table is NOT managed by sqldoc migrations — it already exists in the DB.

CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  zip TEXT
);
