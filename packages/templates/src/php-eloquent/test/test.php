<?php
// Integration test for @sqldoc/templates/php-eloquent
// Connects to real Postgres, verifies data matches expected schema.

$databaseUrl = getenv('DATABASE_URL');
if (!$databaseUrl) {
    fwrite(STDERR, "DATABASE_URL not set\n");
    exit(1);
}

$failed = 0;

function assert_eq($actual, $expected, string $msg): void {
    global $failed;
    if ($actual !== $expected) {
        fwrite(STDERR, "FAIL: $msg (got " . var_export($actual, true) . ", expected " . var_export($expected, true) . ")\n");
        $failed++;
    } else {
        echo "  ok: $msg\n";
    }
}

echo "--- php-eloquent integration test ---\n";

// Parse DATABASE_URL
$parts = parse_url($databaseUrl);
$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s',
    $parts['host'],
    $parts['port'] ?? 5432,
    ltrim($parts['path'] ?? '/postgres', '/')
);

$pdo = new PDO($dsn, $parts['user'] ?? 'postgres', $parts['pass'] ?? 'postgres');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// 1. Query user
$stmt = $pdo->query("SELECT id, email, name, age, is_active FROM users WHERE id = 1");
$user = $stmt->fetch(PDO::FETCH_ASSOC);

assert_eq($user['email'], 'test@example.com', 'user.email matches');
assert_eq($user['name'], 'Test User', 'user.name matches');
assert_eq((int)$user['age'], 30, 'user.age matches');
assert_eq((bool)$user['is_active'], true, 'user.is_active matches');

// 2. Query post
$stmt = $pdo->query("SELECT id, user_id, title, body, view_count FROM content.posts WHERE id = 1");
$post = $stmt->fetch(PDO::FETCH_ASSOC);

assert_eq($post['title'], 'Hello World', 'post.title matches');
assert_eq((int)$post['user_id'], 1, 'post.user_id matches');
assert_eq((int)$post['view_count'], 42, 'post.view_count matches');

if ($failed > 0) {
    fwrite(STDERR, "\n{$failed} assertion(s) failed\n");
    exit(1);
}
echo "\nAll assertions passed!\n";
