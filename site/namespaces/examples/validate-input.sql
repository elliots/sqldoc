CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  -- @validate.notEmpty
  name VARCHAR(100) NOT NULL,
  -- @validate.range(min: 0, max: 99999)
  price NUMERIC(10,2) NOT NULL,
  -- @validate.pattern('^[A-Z]{3}-[0-9]{4}$')
  sku VARCHAR(20) NOT NULL,
  -- @validate.length(min: 10, max: 500)
  description TEXT
);
