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

	fmt.Println("--- go-structs integration test ---")

	// 1. Query user into generated struct
	var user models.User
	err = conn.QueryRow(ctx, "SELECT id, email, name, age, is_active FROM users WHERE id = 1").
		Scan(&user.Id, &user.Email, &user.Name, &user.Age, &user.IsActive)
	if err != nil {
		fmt.Fprintf(os.Stderr, "query user error: %v\n", err)
		os.Exit(1)
	}
	assert(user.Email == "test@example.com", "user.Email matches")
	assert(user.Name != nil && *user.Name == "Test User", "user.Name matches")
	assert(user.Age != nil && *user.Age == 30, "user.Age matches")
	assert(user.IsActive == true, "user.IsActive matches")

	// 2. Query post into generated struct
	var post models.Post
	err = conn.QueryRow(ctx, "SELECT id, user_id, title, body, view_count FROM posts WHERE id = 1").
		Scan(&post.Id, &post.UserId, &post.Title, &post.Body, &post.ViewCount)
	if err != nil {
		fmt.Fprintf(os.Stderr, "query post error: %v\n", err)
		os.Exit(1)
	}
	assert(post.Title == "Hello World", "post.Title matches")
	assert(post.UserId == 1, "post.UserId matches")
	assert(post.ViewCount == 42, "post.ViewCount matches")

	if failed > 0 {
		fmt.Fprintf(os.Stderr, "\n%d assertion(s) failed\n", failed)
		os.Exit(1)
	}
	fmt.Println("\nAll assertions passed!")
}
