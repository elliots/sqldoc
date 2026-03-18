-- @import '@sqldoc/ns-rls'

-- @rls
-- @rls.policy(for: SELECT, to: authenticated, using: 'user_id = current_user_id()')
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL
);

-- @rls
-- @rls.policy(for: ALL, to: admin)
CREATE TABLE settings (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT
);
