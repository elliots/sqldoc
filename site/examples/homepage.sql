-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-codegen'
-- @import '@sqldoc/ns-docs'
-- @import '@sqldoc/ns-rls'
-- @import '@sqldoc/ns-validate'

-- @docs.description('User accounts for the application')
-- @audit(on: [insert])
-- @rls
-- @rls.policy(for: ALL, to: authenticated, using: 'user_id = current_setting(''app.user_id'')::int')
CREATE TABLE users (
  -- @codegen.rename('id')
  user_id SERIAL PRIMARY KEY,

  -- @validate.pattern('^.+@.+\..+$')
  email VARCHAR(100) NOT NULL,

  -- @audit.redact(strategy: omit)
  password_hash TEXT NOT NULL
);
