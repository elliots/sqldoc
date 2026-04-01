-- @anon
CREATE TABLE patients (
  id SERIAL PRIMARY KEY,
  -- @anon.mask('anon.partial(email, 2, $$***$$, 2)')
  email VARCHAR(255) NOT NULL,
  -- @anon.fake('anon.fake_last_name()')
  last_name VARCHAR(100) NOT NULL,
  diagnosis TEXT
);
