-- @comment('Primary user accounts table')
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  -- @comment('User email address, must be unique')
  email VARCHAR(255) NOT NULL UNIQUE,
  -- @comment('Display name shown in UI')
  name VARCHAR(100) NOT NULL
);
