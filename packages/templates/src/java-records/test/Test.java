import java.sql.*;
import java.time.OffsetDateTime;

/**
 * Integration test for @sqldoc/templates/java-records
 * Connects to real Postgres, verifies generated records work with actual data.
 */
public class Test {
    static int failed = 0;

    static void assertEq(Object actual, Object expected, String msg) {
        if (!actual.equals(expected)) {
            System.err.printf("FAIL: %s (got %s, expected %s)%n", msg, actual, expected);
            failed++;
        } else {
            System.out.printf("  ok: %s%n", msg);
        }
    }

    public static void main(String[] args) throws Exception {
        String dbUrl = System.getenv("DATABASE_URL");
        if (dbUrl == null || dbUrl.isEmpty()) {
            System.err.println("DATABASE_URL not set");
            System.exit(1);
        }

        // Convert postgres(ql):// to jdbc:postgresql://, extracting userinfo for JDBC
        var uri = java.net.URI.create(dbUrl.replaceFirst("^postgres(ql)?://", "http://"));
        var userInfo = uri.getUserInfo();
        var jdbcUrl = "jdbc:postgresql://" + uri.getHost() + ":" + (uri.getPort() > 0 ? uri.getPort() : 5432) + uri.getPath();
        var query = uri.getQuery();
        if (userInfo != null) {
            var parts = userInfo.split(":", 2);
            var sep = query != null ? "&" : "?";
            jdbcUrl += (query != null ? "?" + query : "") + sep + "user=" + parts[0] + "&password=" + (parts.length > 1 ? parts[1] : "");
        } else if (query != null) {
            jdbcUrl += "?" + query;
        }
        dbUrl = jdbcUrl;

        System.out.println("--- java-records integration test ---");

        try (Connection conn = DriverManager.getConnection(dbUrl)) {
            // 1. Query user and construct generated record
            try (PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = 1")) {
                ResultSet rs = ps.executeQuery();
                rs.next();
                var user = new User(
                    rs.getLong("id"),
                    rs.getString("email"),
                    rs.getString("name"),
                    rs.getObject("age") != null ? rs.getInt("age") : null,
                    rs.getBoolean("is_active"),
                    rs.getString("metadata"),
                    null, // address (composite)
                    rs.getObject("created_at", OffsetDateTime.class),
                    null, // tags (array)
                    rs.getBytes("avatar"),
                    rs.getBigDecimal("balance"),
                    rs.getObject("external_id") != null ? java.util.UUID.fromString(rs.getString("external_id")) : null
                );
                assertEq(user.email(), "test@example.com", "user.email() matches");
                assertEq(user.name(), "Test User", "user.name() matches");
                assertEq(user.age(), 30, "user.age() matches");
                assertEq(user.isActive(), true, "user.isActive() matches");
            }

            // 2. Query post and construct generated record
            try (PreparedStatement ps = conn.prepareStatement("SELECT * FROM content.posts WHERE id = 1")) {
                ResultSet rs = ps.executeQuery();
                rs.next();
                var post = new ContentPost(
                    rs.getLong("id"),
                    rs.getLong("user_id"),
                    rs.getString("title"),
                    rs.getString("body"),
                    rs.getObject("published_at") != null ? rs.getObject("published_at", OffsetDateTime.class) : null,
                    rs.getInt("view_count"),
                    rs.getObject("rating") != null ? rs.getDouble("rating") : null
                );
                assertEq(post.title(), "Hello World", "post.title() matches");
                assertEq(post.userId(), 1L, "post.userId() matches");
                assertEq(post.viewCount(), 42, "post.viewCount() matches");
            }
        }

        if (failed > 0) {
            System.err.printf("%n%d assertion(s) failed%n", failed);
            System.exit(1);
        }
        System.out.println("\nAll assertions passed!");
    }
}
