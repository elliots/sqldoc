-- @codegen.rename('ProductItem')
-- @codegen.type(id: 'branded')
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price NUMERIC(10,2),
  -- @codegen.skip
  internal_notes TEXT
);
