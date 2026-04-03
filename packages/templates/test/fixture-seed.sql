-- Seed data for integration tests
-- Must match the schema in fixture.sql

INSERT INTO users (id, email, name, age, is_active, created_at)
VALUES (1, 'test@example.com', 'Test User', 30, true, '2024-01-01T00:00:00Z');

INSERT INTO content.posts (id, user_id, title, body, published_at, view_count, rating)
VALUES (1, 1, 'Hello World', 'First post body', '2024-01-01T00:00:00Z', 42, 4.5);

INSERT INTO comments (id, post_id, user_id, content, created_at)
VALUES (1, 1, 1, 'Great post!', '2024-01-01T00:00:00Z');

-- Reset sequences to avoid conflicts when inserting new rows
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
SELECT setval('content.posts_id_seq', (SELECT MAX(id) FROM content.posts));
SELECT setval('comments_id_seq', (SELECT MAX(id) FROM comments));
