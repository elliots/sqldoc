-- @import '@sqldoc/ns-validate'

CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  -- @validate.notEmpty
  username TEXT NOT NULL,
  -- @validate.length(min: 8, max: 100)
  password_hash TEXT NOT NULL,
  -- @validate.range(min: 0, max: 150)
  age INTEGER,
  -- @validate.pattern('[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+')
  email TEXT NOT NULL
);
