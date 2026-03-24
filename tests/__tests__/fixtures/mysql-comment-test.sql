-- @import '@sqldoc/ns-comment'

-- @comment('Primary product catalog')
CREATE TABLE products (
  -- @comment('Product display name')
  name VARCHAR(255) NOT NULL,
  -- @comment('Price in cents to avoid floating point')
  price INT NOT NULL
);
