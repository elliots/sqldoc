package main

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5"

	"sqldoc-test/models"
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

	// 1. Query known seeded user into generated User struct
	var user models.User
	err = conn.QueryRow(ctx,
		"SELECT id, email, name, age, is_active, created_at FROM users WHERE id = 1").
		Scan(&user.Id, &user.Email, &user.Name, &user.Age, &user.IsActive, &user.CreatedAt)
	if err != nil {
		fmt.Fprintf(os.Stderr, "query user error: %v\n", err)
		os.Exit(1)
	}
	assert(user.Email == "test@example.com", "user.Email matches")
	assert(user.Name.Valid && user.Name.String == "Test User", "user.Name matches")
	assert(user.Age.Valid && user.Age.Int32 == 30, "user.Age matches")
	assert(user.IsActive, "user.IsActive matches")
	assert(user.Id == 1, "user.Id matches")

	// 2. Query known seeded post into generated ContentPost struct
	var post models.ContentPost
	err = conn.QueryRow(ctx,
		"SELECT id, user_id, title, body, published_at, view_count, rating FROM content.posts WHERE id = 1").
		Scan(&post.Id, &post.UserId, &post.Title, &post.Body, &post.PublishedAt, &post.ViewCount, &post.Rating)
	if err != nil {
		fmt.Fprintf(os.Stderr, "query post error: %v\n", err)
		os.Exit(1)
	}
	assert(post.Title == "Hello World", "post.Title matches")
	assert(post.UserId == 1, "post.UserId matches")
	assert(post.ViewCount == 42, "post.ViewCount matches")
	assert(post.Rating.Valid && post.Rating.Float64 == 4.5, "post.Rating matches")

	// 3. Insert a new post
	_, err = conn.Exec(ctx,
		"INSERT INTO content.posts (user_id, title, body, view_count) VALUES (1, 'Post from sqlc', 'test body', 0)")
	if err != nil {
		fmt.Fprintf(os.Stderr, "insert error: %v\n", err)
		os.Exit(1)
	}

	// 4. Read it back into a ContentPost struct
	var newPost models.ContentPost
	err = conn.QueryRow(ctx,
		"SELECT id, user_id, title, body, published_at, view_count, rating FROM content.posts WHERE title = 'Post from sqlc'").
		Scan(&newPost.Id, &newPost.UserId, &newPost.Title, &newPost.Body, &newPost.PublishedAt, &newPost.ViewCount, &newPost.Rating)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read back error: %v\n", err)
		os.Exit(1)
	}
	assert(newPost.Title == "Post from sqlc", "inserted post.Title matches")
	assert(newPost.UserId == 1, "inserted post.UserId matches")
	assert(newPost.ViewCount == 0, "inserted post.ViewCount matches")

	if failed > 0 {
		fmt.Fprintf(os.Stderr, "\n%d assertion(s) failed\n", failed)
		os.Exit(1)
	}
	fmt.Println("\nAll assertions passed!")
}
