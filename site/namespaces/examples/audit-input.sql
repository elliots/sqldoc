-- @audit(on: [insert, update, delete])
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending'
);
