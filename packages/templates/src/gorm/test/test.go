package main

import (
	"fmt"
	"os"

	"sqldoc-test/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL not set")
		os.Exit(1)
	}

	db, err := gorm.Open(postgres.Open(dbURL), &gorm.Config{})
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect error: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("--- gorm integration test ---")

	// 1. Query user via GORM using generated model
	var user models.User
	if err := db.First(&user, 1).Error; err != nil {
		fmt.Fprintf(os.Stderr, "query user error: %v\n", err)
		os.Exit(1)
	}
	assert(user.Email == "test@example.com", "user.Email matches")
	assert(user.Name != nil && *user.Name == "Test User", "user.Name matches")
	assert(user.Age != nil && *user.Age == 30, "user.Age matches")
	assert(user.IsActive == true, "user.IsActive matches")

	// 2. Query post via GORM using generated model
	var post models.ContentPost
	if err := db.First(&post, 1).Error; err != nil {
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
