-- @docs.description('Central inventory of all products')
-- @docs.emit(format: html, output: './docs/products.html')
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  price NUMERIC(10,2)
);
