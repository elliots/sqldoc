// Integration test for @sqldoc/templates/rust-structs
// Connects to real Postgres, verifies generated structs work with actual data.
//
// Note: `mod models;` is prepended by the Dockerfile.

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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL not set");

    let (client, connection) = tokio_postgres::connect(&db_url, tokio_postgres::NoTls).await?;

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("connection error: {}", e);
        }
    });

    println!("--- rust-structs integration test ---");

    // 1. Query user and populate generated struct
    let row = client
        .query_one("SELECT id, email, name, age, is_active FROM users WHERE id = 1", &[])
        .await?;
    let user = User {
        id: row.get("id"),
        email: row.get("email"),
        name: row.get("name"),
        age: row.get("age"),
        is_active: row.get("is_active"),
        metadata: None,
        address: None,
        created_at: chrono::Utc::now(),
        tags: None,
        avatar: None,
        balance: None,
        external_id: None,
    };
    assert_eq_val(user.email.as_str(), "test@example.com", "user.email matches");
    assert_eq_val(user.name, Some("Test User".to_string()), "user.name matches");
    assert_eq_val(user.age, Some(30), "user.age matches");
    assert_eq_val(user.is_active, true, "user.is_active matches");

    // 2. Query post and populate generated struct
    let row = client
        .query_one("SELECT id, user_id, title, body, view_count FROM content.posts WHERE id = 1", &[])
        .await?;
    let post = ContentPost {
        id: row.get("id"),
        user_id: row.get("user_id"),
        title: row.get("title"),
        body: row.get("body"),
        published_at: None,
        view_count: row.get("view_count"),
        rating: None,
    };
    assert_eq_val(post.title.as_str(), "Hello World", "post.title matches");
    assert_eq_val(post.user_id, 1i64, "post.user_id matches");
    assert_eq_val(post.view_count, 42i32, "post.view_count matches");

    let fail_count = FAILED.load(Ordering::SeqCst);
    if fail_count > 0 {
        eprintln!("\n{} assertion(s) failed", fail_count);
        std::process::exit(1);
    }
    println!("\nAll assertions passed!");
    Ok(())
}
