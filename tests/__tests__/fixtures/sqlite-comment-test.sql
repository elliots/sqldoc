-- @import '@sqldoc/ns-comment'

-- @comment('Primary product catalog')
CREATE TABLE products (
  -- @comment('Product display name')
  name TEXT NOT NULL,
  -- @comment('Price in cents')
  price INTEGER NOT NULL
);
