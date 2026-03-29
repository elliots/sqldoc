"""
Integration test for @sqldoc/templates/pydantic
Connects to real Postgres, verifies generated Pydantic models work with actual data.
"""
import os
import sys
import psycopg2

from models import User, Post

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("DATABASE_URL not set", file=sys.stderr)
    sys.exit(1)

failed = 0


def assert_eq(actual, expected, msg):
    global failed
    if actual != expected:
        print(f"FAIL: {msg} (got {actual!r}, expected {expected!r})", file=sys.stderr)
        failed += 1
    else:
        print(f"  ok: {msg}")


def main():
    global failed
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()

    print("--- pydantic integration test ---")

    # 1. Query user and construct Pydantic model
    cur.execute("SELECT id, email, name, age, is_active, created_at FROM users WHERE id = 1")
    row = cur.fetchone()
    user = User(id=row[0], email=row[1], name=row[2], age=row[3], is_active=row[4], created_at=row[5])
    assert_eq(user.email, "test@example.com", "user.email matches")
    assert_eq(user.name, "Test User", "user.name matches")
    assert_eq(user.age, 30, "user.age matches")
    assert_eq(user.is_active, True, "user.is_active matches")

    # 2. Query post and construct Pydantic model
    cur.execute("SELECT id, user_id, title, body, view_count, rating FROM posts WHERE id = 1")
    row = cur.fetchone()
    post = Post(id=row[0], user_id=row[1], title=row[2], body=row[3], view_count=row[4], rating=row[5])
    assert_eq(post.title, "Hello World", "post.title matches")
    assert_eq(post.user_id, 1, "post.user_id matches")
    assert_eq(post.view_count, 42, "post.view_count matches")

    cur.close()
    conn.close()

    if failed > 0:
        print(f"\n{failed} assertion(s) failed", file=sys.stderr)
        sys.exit(1)
    print("\nAll assertions passed!")


if __name__ == "__main__":
    main()
