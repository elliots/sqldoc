-- @import '@sqldoc/ns-deprecated'

-- @deprecated.replace('user_profiles')
CREATE TABLE legacy_users (
  id SERIAL PRIMARY KEY,
  -- @deprecated.remove('2025-12-01')
  old_email TEXT,
  name TEXT NOT NULL
);
