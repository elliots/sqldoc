-- @import '@sqldoc/ns-anon'

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  -- @anon.mask('anon.fake_email()')
  email VARCHAR(255) NOT NULL,
  -- @anon.fake('anon.random_string(10)')
  phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);
