-- @import '@sqldoc/ns-comment'
-- @import '@sqldoc/ns-postgraphile'


-- @comment('Primary product catalog')
CREATE TABLE products (
  -- @comment('Unique identifier for each product')
  id SERIAL PRIMARY KEY,
  -- @comment('Product display name')
  -- @pg.name('productName')
  name TEXT NOT NULL,
  -- @comment('Price in cents to avoid floating point')
  price INTEGER NOT NULL
);


COMMENT ON TABLE products IS 'Existing comment on products table';

COMMENT ON COLUMN products.name IS 'Existing comment on name column';