-- @import '@sqldoc/ns-docs'

-- @docs.description('Application users')
CREATE TABLE users2 (
    id BIGSERIAL PRIMARY KEY,

    -- @docs.description('Login email address')
    -- @docs.previously('email')
    email2 UUID NOT NULL UNIQUE,

    -- @docs.description('Display name')
    name TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @docs.description('User-created posts')
CREATE TABLE posts (
    id BIGSERIAL PRIMARY KEY,

    -- @docs.description('Author of the post')
    user_id BIGINT NOT NULL REFERENCES users2(id),

    title TEXT NOT NULL,
    body TEXT,
    published BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
