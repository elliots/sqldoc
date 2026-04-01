-- @deprecated('Use user_profiles instead')
-- @deprecated.remove('2025-06-01')
CREATE TABLE user_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  theme VARCHAR(20) DEFAULT 'light'
);
