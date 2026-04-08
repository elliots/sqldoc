// Integration test for @sqldoc/templates/swift-codable
// Validates JSON encoding/decoding round-trip for generated Codable structs.

import Foundation

var failed = 0

func assertEq<T: Equatable>(_ actual: T, _ expected: T, _ msg: String) {
    if actual != expected {
        fputs("FAIL: \(msg) (got \(actual), expected \(expected))\n", stderr)
        failed += 1
    } else {
        print("  ok: \(msg)")
    }
}

print("--- swift-codable integration test ---")

// Test User JSON round-trip
let userJson = """
{"id": 1, "email": "test@example.com", "name": "Test User", "age": 30, "is_active": true, "created_at": "2024-01-01T00:00:00Z"}
"""

let decoder = JSONDecoder()
decoder.dateDecodingStrategy = .iso8601

do {
    let user = try decoder.decode(User.self, from: userJson.data(using: .utf8)!)
    assertEq(user.id, 1, "user.id matches")
    assertEq(user.email, "test@example.com", "user.email matches")
    assertEq(user.name, "Test User", "user.name matches")
    assertEq(user.age, 30, "user.age matches")
    assertEq(user.isActive, true, "user.isActive matches")

    // Encode back to JSON (must use same date strategy)
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let encoded = try encoder.encode(user)
    let decoded = try decoder.decode(User.self, from: encoded)
    assertEq(decoded.email, user.email, "round-trip email matches")
    assertEq(decoded.id, user.id, "round-trip id matches")
} catch {
    fputs("FAIL: User decode error: \(error)\n", stderr)
    failed += 1
}

// Test Post JSON round-trip
let postJson = """
{"id": 1, "user_id": 1, "title": "Hello World", "body": "First post body", "view_count": 42, "rating": 4.5}
"""

do {
    let post = try decoder.decode(Post.self, from: postJson.data(using: .utf8)!)
    assertEq(post.title, "Hello World", "post.title matches")
    assertEq(post.userId, 1, "post.userId matches")
    assertEq(post.viewCount, 42, "post.viewCount matches")
} catch {
    fputs("FAIL: Post decode error: \(error)\n", stderr)
    failed += 1
}

if failed > 0 {
    fputs("\n\(failed) assertion(s) failed\n", stderr)
    exit(1)
}
print("\nAll assertions passed!")
