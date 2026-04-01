-- @rls
-- @rls.policy(for: SELECT, to: authenticated, using: 'user_id = current_user_id()')
-- @rls.policy(for: ALL, to: admin, using: 'true')
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT
);
