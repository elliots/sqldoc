-- @import '@sqldoc/ns-anon'
-- @import '@sqldoc/ns-rls'

-- @rls
-- @rls.policy(for: SELECT, to: authenticated, using: 'owner_id = current_user_id()')
CREATE TABLE profiles (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  -- @anon.mask('anon.partial_email()')
  email VARCHAR(255) NOT NULL,
  display_name TEXT
);
