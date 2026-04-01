-- @pg.simpleCollections
-- @pg.name('Customer')
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  -- @pg.omit(update)
  created_at TIMESTAMP DEFAULT now()
);
