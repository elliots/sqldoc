package main

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5"

	// Import the generated models to verify they compile
	_ "sqldoc-test/models"
)

var failed int

func assert(condition bool, msg string) {
	if !condition {
		fmt.Fprintf(os.Stderr, "FAIL: %s\n", msg)
		failed++
	} else {
		fmt.Printf("  ok: %s\n", msg)
	}
}

func main() {
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL not set")
		os.Exit(1)
	}

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect error: %v\n", err)
		os.Exit(1)
	}
	defer conn.Close(ctx)

	fmt.Println("--- sqlc integration test ---")

	// 1. Query known seeded user
	var email, name string
	var age int32
	var isActive bool
	err = conn.QueryRow(ctx, "SELECT email, name, age, is_active FROM users WHERE id = 1").
		Scan(&email, &name, &age, &isActive)
	if err != nil {
		fmt.Fprintf(os.Stderr, "query user error: %v\n", err)
		os.Exit(1)
	}
	assert(email == "test@example.com", "user email matches")
	assert(name == "Test User", "user name matches")
	assert(age == 30, "user age matches")
	assert(isActive, "user is_active matches")

	// 2. Query known seeded post
	var title string
	err = conn.QueryRow(ctx, "SELECT title FROM posts WHERE id = 1").Scan(&title)
	if err != nil {
		fmt.Fprintf(os.Stderr, "query post error: %v\n", err)
		os.Exit(1)
	}
	assert(title == "Hello World", "post title matches")

	// 3. Insert a new post
	_, err = conn.Exec(ctx,
		"INSERT INTO posts (user_id, title, body, view_count) VALUES (1, 'Post from sqlc', 'test body', 0)")
	if err != nil {
		fmt.Fprintf(os.Stderr, "insert error: %v\n", err)
		os.Exit(1)
	}

	// 4. Read it back
	var newTitle string
	var userID int64
	err = conn.QueryRow(ctx, "SELECT title, user_id FROM posts WHERE title = 'Post from sqlc'").
		Scan(&newTitle, &userID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read back error: %v\n", err)
		os.Exit(1)
	}
	assert(newTitle == "Post from sqlc", "inserted post title matches")
	assert(userID == 1, "inserted post user_id matches")

	if failed > 0 {
		fmt.Fprintf(os.Stderr, "\n%d assertion(s) failed\n", failed)
		os.Exit(1)
	}
	fmt.Println("\nAll assertions passed!")
}
