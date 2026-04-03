"""
Integration test for @sqldoc/templates/sqlalchemy
Connects to real Postgres, verifies generated SQLAlchemy models work with actual data.
"""
import os
import sys

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import models

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
    engine = create_engine(DATABASE_URL)

    print("--- sqlalchemy integration test ---")

    with Session(engine) as session:
        # 1. Query known seeded user via ORM model
        user = session.query(models.User).filter_by(id=1).one()
        assert_eq(user.email, "test@example.com", "user email matches")
        assert_eq(user.name, "Test User", "user name matches")
        assert_eq(user.age, 30, "user age matches")
        assert_eq(user.is_active, True, "user is_active matches")

        # 2. Query known seeded post via ORM model
        post = session.query(models.ContentPost).filter_by(id=1).one()
        assert_eq(post.title, "Hello World", "post title matches")

        # 3. Query view via Table object
        rows = session.execute(select(models.active_users)).fetchall()
        assert_eq(len(rows) >= 1, True, "active_users view returns rows")
        row = rows[0]
        assert_eq(row.email, "test@example.com", "view email matches")

    if failed > 0:
        print(f"\n{failed} assertion(s) failed", file=sys.stderr)
        sys.exit(1)
    print("\nAll assertions passed!")


if __name__ == "__main__":
    main()
