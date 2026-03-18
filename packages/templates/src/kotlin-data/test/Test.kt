import java.sql.DriverManager

/**
 * Integration test for @sqldoc/templates/kotlin-data
 * Connects to real Postgres via JDBC, verifies generated data classes work with actual data.
 */
var failed = 0

fun assertEq(actual: Any?, expected: Any?, msg: String) {
    if (actual != expected) {
        System.err.println("FAIL: $msg (got $actual, expected $expected)")
        failed++
    } else {
        println("  ok: $msg")
    }
}

fun main() {
    var dbUrl = System.getenv("DATABASE_URL")
    if (dbUrl.isNullOrEmpty()) {
        System.err.println("DATABASE_URL not set")
        System.exit(1)
    }

    // Convert postgres(ql):// to jdbc:postgresql://, extracting userinfo for JDBC
    val uri = java.net.URI(dbUrl.replaceFirst(Regex("^postgres(ql)?://"), "http://"))
    val userInfo = uri.userInfo
    var jdbcUrl = "jdbc:postgresql://${uri.host}:${if (uri.port > 0) uri.port else 5432}${uri.path}"
    val query = uri.query
    if (userInfo != null) {
        val parts = userInfo.split(":", limit = 2)
        val sep = if (query != null) "&" else "?"
        jdbcUrl += (if (query != null) "?$query" else "") + "${sep}user=${parts[0]}&password=${parts.getOrElse(1) { "" }}"
    } else if (query != null) {
        jdbcUrl += "?$query"
    }
    dbUrl = jdbcUrl

    println("--- kotlin-data integration test ---")

    DriverManager.getConnection(dbUrl).use { conn ->
        // 1. Query user and construct generated data class
        conn.prepareStatement("SELECT id, email, name, age, is_active, created_at FROM users WHERE id = 1").use { ps ->
            val rs = ps.executeQuery()
            rs.next()
            val user = Users(
                id = rs.getLong("id"),
                email = rs.getString("email"),
                name = rs.getString("name"),
                age = rs.getInt("age"),
                isActive = rs.getBoolean("is_active"),
                createdAt = rs.getObject("created_at", java.time.OffsetDateTime::class.java)
            )
            assertEq(user.email, "test@example.com", "user.email matches")
            assertEq(user.name, "Test User", "user.name matches")
            assertEq(user.age, 30, "user.age matches")
            assertEq(user.isActive, true, "user.isActive matches")
        }

        // 2. Query post and construct generated data class
        conn.prepareStatement("SELECT id, user_id, title, body, view_count FROM posts WHERE id = 1").use { ps ->
            val rs = ps.executeQuery()
            rs.next()
            val post = Posts(
                id = rs.getLong("id"),
                userId = rs.getLong("user_id"),
                title = rs.getString("title"),
                body = rs.getString("body"),
                viewCount = rs.getInt("view_count")
            )
            assertEq(post.title, "Hello World", "post.title matches")
            assertEq(post.userId, 1L, "post.userId matches")
            assertEq(post.viewCount, 42, "post.viewCount matches")
        }
    }

    if (failed > 0) {
        System.err.println("\n$failed assertion(s) failed")
        System.exit(1)
    }
    println("\nAll assertions passed!")
}
