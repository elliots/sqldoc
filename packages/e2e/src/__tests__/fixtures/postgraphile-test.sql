-- @import '@sqldoc/ns-postgraphile'

-- @pg.simpleCollections
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  -- @pg.name('postTitle')
  title TEXT NOT NULL,
  -- @pg.omit
  internal_notes TEXT,
  -- @pg.deprecated('Use content_html instead')
  body TEXT
);
