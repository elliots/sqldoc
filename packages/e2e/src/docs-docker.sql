-- @import '@sqldoc/ns-docs'
-- @import '@sqldoc/ns-anon'
-- @import '@sqldoc/ns-comment'
-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-rls'
-- @import '@sqldoc/ns-validate'
-- @import '@sqldoc/ns-deprecated'
-- @import '@sqldoc/ns-postgraphile'

-- Prerequisites
CREATE EXTENSION IF NOT EXISTS anon CASCADE;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE OR REPLACE FUNCTION current_user_id() RETURNS BIGINT AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::BIGINT;
$$ LANGUAGE sql STABLE;

-- @comment('Core user accounts')
-- @docs.description('The main users table storing all account information')
-- @audit(on: [insert, update, delete], destination: audit_log)
-- @rls
-- @rls.policy(for: SELECT, to: authenticated, using: 'true')
-- @rls.policy(for: ALL, to: authenticated, using: 'id = current_user_id()')
-- @pg.simpleCollections
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,

    -- @comment('Primary login email')
    -- @anon.mask('anon.fake_email()')
    -- @validate.pattern('[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+')
    -- @validate.notEmpty
    -- @pg.name('loginEmail')
    email TEXT NOT NULL UNIQUE,

    -- @comment('Display name shown in the UI')
    -- @validate.length(min: 3, max: 50)
    -- @pg.name('displayName')
    username TEXT NOT NULL UNIQUE,

    -- @anon.mask('anon.random_string(60)')
    -- @validate.length(min: 8)
    -- @pg.omit
    -- @audit.redact(strategy: hash)
    password_hash TEXT NOT NULL,

    -- @comment('User biography, supports markdown')
    -- @docs.description('Free-text bio field, rendered as markdown in the frontend')
    -- @anon.fake('anon.lorem_ipsum()')
    bio TEXT,

    -- @validate.range(min: 13, max: 150)
    age INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @comment('Maps users to their roles')
-- @rls
-- @rls.policy(for: ALL, to: authenticated, using: 'user_id = current_user_id()')
CREATE TABLE user_roles (
    user_id BIGINT NOT NULL REFERENCES users(id),

    role TEXT NOT NULL DEFAULT 'user',
    PRIMARY KEY (user_id, role)
);

-- @comment('Blog posts authored by users')
-- @docs.description('Posts created by users, supports markdown body content')
-- @audit(on: [insert, update], destination: audit_log)
-- @rls
-- @rls.policy(for: SELECT, to: authenticated, using: 'true')
-- @rls.policy(for: ALL, to: authenticated, using: 'author_id = current_user_id()')
-- @pg.simpleCollections
CREATE TABLE posts (
    id BIGSERIAL PRIMARY KEY,

    -- @comment('Foreign key to the post author')
    author_id BIGINT NOT NULL REFERENCES users(id),

    -- @comment('Post title, shown in listings and SEO')
    -- @validate.notEmpty
    -- @validate.length(max: 200)
    title TEXT NOT NULL,

    -- @comment('Post body in markdown format')
    -- @validate.notEmpty
    body TEXT NOT NULL,

    -- @deprecated.replace('status')
    published BOOLEAN DEFAULT false,

    -- @comment('Publication state: draft, published, or archived')
    status TEXT NOT NULL DEFAULT 'draft',

    -- @pg.behavior('-update')
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @comment('Tracks which posts a user has bookmarked')
-- @docs.description('Join table for user bookmarks — each row is a saved post')
-- @rls
-- @rls.policy(for: ALL, to: authenticated, using: 'user_id = current_user_id()')
CREATE TABLE bookmarks (
    user_id BIGINT NOT NULL REFERENCES users(id),
    post_id BIGINT NOT NULL REFERENCES posts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);

-- @comment('Tags for categorizing posts')
CREATE TABLE tags (
    id BIGSERIAL PRIMARY KEY,

    -- @validate.notEmpty
    -- @validate.length(min: 1, max: 50)
    name TEXT NOT NULL UNIQUE,

    -- @comment('URL-friendly version of the tag name')
    -- @validate.pattern('[a-z0-9-]+')
    slug TEXT NOT NULL UNIQUE
);

-- @comment('Many-to-many relationship between posts and tags')
CREATE TABLE post_tags (
    post_id BIGINT NOT NULL REFERENCES posts(id),
    tag_id BIGINT NOT NULL REFERENCES tags(id),
    PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX idx_posts_author ON posts (author_id);
CREATE INDEX idx_posts_status ON posts (status);
CREATE INDEX idx_post_tags_tag ON post_tags (tag_id);
