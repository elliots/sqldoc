-- Shared test fixture for all template generation tests.
-- Runs through the full sqldoc compile pipeline (pglite).
-- @import '@sqldoc/ns-codegen'
-- @import '@sqldoc/ns-validate'

CREATE TYPE address AS (street text, city text, zip varchar(10), country text);

CREATE TABLE users (
  id bigserial PRIMARY KEY,
  -- @validate.pattern(.+@.+\..+)
  email varchar(255) NOT NULL UNIQUE,
  name text,
  -- @validate.range(min: 0, max: 120)
  age integer,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb,
  address address,
  created_at timestamptz NOT NULL DEFAULT now(),
  tags text[],
  avatar bytea,
  balance numeric(10,2),
  external_id uuid
);

CREATE SCHEMA content;

CREATE TABLE content.posts (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  title text NOT NULL,
  body text NOT NULL,
  published_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  rating double precision
);

CREATE TYPE post_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE comments (
  id bigserial PRIMARY KEY,
  post_id bigint NOT NULL REFERENCES content.posts(id),
  user_id bigint NOT NULL REFERENCES users(id),
  parent_id bigint REFERENCES comments(id),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE post_tags (
  post_id bigint NOT NULL REFERENCES content.posts(id),
  tag_id bigint NOT NULL REFERENCES comments(id),
  PRIMARY KEY (post_id, tag_id)
);

CREATE VIEW active_users AS
  SELECT id, email, name, created_at
  FROM users
  WHERE is_active = true;

CREATE FUNCTION get_user_posts(p_user_id bigint) RETURNS SETOF content.posts AS $$
  SELECT * FROM content.posts WHERE user_id = p_user_id;
$$ LANGUAGE sql;

CREATE TYPE user_summary AS (user_id bigint, email varchar(255), post_count integer, latest_post_at timestamptz);

CREATE FUNCTION get_user_summaries(p_min_posts integer DEFAULT 0) RETURNS SETOF user_summary
  LANGUAGE sql STABLE AS $$
  SELECT u.id, u.email, count(p.id)::integer, max(p.published_at)
  FROM users u LEFT JOIN content.posts p ON p.user_id = u.id
  GROUP BY u.id, u.email
  HAVING count(p.id) >= p_min_posts;
$$;
