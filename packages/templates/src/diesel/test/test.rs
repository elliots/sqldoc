// Integration test for @sqldoc/templates/diesel
// Connects to real Postgres, verifies generated schema + models work with actual data.
//
// Note: `mod schema;` and `mod models;` are prepended by the Dockerfile.

use diesel::prelude::*;
use diesel::pg::PgConnection;
use models::{User, ContentPost};

use std::sync::atomic::{AtomicUsize, Ordering};

static FAILED: AtomicUsize = AtomicUsize::new(0);

fn assert_eq_val<T: PartialEq + std::fmt::Debug>(actual: T, expected: T, msg: &str) {
    if actual != expected {
        eprintln!("FAIL: {} (got {:?}, expected {:?})", msg, actual, expected);
        FAILED.fetch_add(1, Ordering::SeqCst);
    } else {
        println!("  ok: {}", msg);
    }
}

fn main() {
    let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL not set");
    let mut conn = PgConnection::establish(&db_url).expect("Failed to connect to database");

    println!("--- diesel integration test ---");

    // 1. Query user via diesel using the generated User model
    {
        use schema::users::dsl::*;
        let user: User = users
            .filter(id.eq(1i64))
            .select(User::as_select())
            .first(&mut conn)
            .expect("Failed to load user");

        assert_eq_val(user.email.as_str(), "test@example.com", "user.email matches");
        assert_eq_val(user.name, Some("Test User".to_string()), "user.name matches");
        assert_eq_val(user.age, Some(30), "user.age matches");
        assert_eq_val(user.is_active, true, "user.is_active matches");
    }

    // 2. Query post via diesel (content schema)
    {
        use schema::posts::dsl::*;
        let post: ContentPost = posts
            .filter(id.eq(1i64))
            .select(ContentPost::as_select())
            .first(&mut conn)
            .expect("Failed to load post");

        assert_eq_val(post.title.as_str(), "Hello World", "post.title matches");
        assert_eq_val(post.user_id, 1i64, "post.user_id matches");
        assert_eq_val(post.view_count, 42i32, "post.view_count matches");
    }

    let fail_count = FAILED.load(Ordering::SeqCst);
    if fail_count > 0 {
        eprintln!("\n{} assertion(s) failed", fail_count);
        std::process::exit(1);
    }
    println!("\nAll assertions passed!");
}
