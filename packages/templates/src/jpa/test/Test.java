import java.sql.*;
import java.lang.reflect.Field;

/**
 * Integration test for @sqldoc/templates/jpa
 * Verifies generated JPA entities compile, have expected fields, and DB has expected data.
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

    static void assertHasField(Class<?> cls, String fieldName, String msg) {
        try {
            cls.getDeclaredField(fieldName);
            System.out.printf("  ok: %s%n", msg);
        } catch (NoSuchFieldException e) {
            System.err.printf("FAIL: %s (field '%s' not found)%n", msg, fieldName);
            failed++;
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

        System.out.println("--- jpa integration test ---");

        // 1. Verify generated entity classes have expected fields
        assertHasField(User.class, "id", "User has 'id' field");
        assertHasField(User.class, "email", "User has 'email' field");
        assertHasField(User.class, "name", "User has 'name' field");
        assertHasField(User.class, "isActive", "User has 'isActive' field");
        assertHasField(Post.class, "title", "Post has 'title' field");
        assertHasField(Post.class, "viewCount", "Post has 'viewCount' field");

        // 2. Instantiate entity and populate via reflection (JPA entities have private fields)
        try (Connection conn = DriverManager.getConnection(dbUrl)) {
            try (PreparedStatement ps = conn.prepareStatement(
                    "SELECT id, email, name, age, is_active FROM users WHERE id = 1")) {
                ResultSet rs = ps.executeQuery();
                rs.next();
                var user = new User();
                setField(user, "id", rs.getLong("id"));
                setField(user, "email", rs.getString("email"));
                setField(user, "name", rs.getString("name"));
                setField(user, "age", rs.getObject("age") != null ? rs.getInt("age") : null);
                setField(user, "isActive", rs.getBoolean("is_active"));

                assertEq(getField(user, "email"), "test@example.com", "user.email matches");
                assertEq(getField(user, "name"), "Test User", "user.name matches");
                assertEq(getField(user, "isActive"), true, "user.isActive matches");
            }

            try (PreparedStatement ps = conn.prepareStatement(
                    "SELECT id, title, view_count FROM posts WHERE id = 1")) {
                ResultSet rs = ps.executeQuery();
                rs.next();
                var post = new Post();
                setField(post, "id", rs.getLong("id"));
                setField(post, "title", rs.getString("title"));
                setField(post, "viewCount", rs.getInt("view_count"));

                assertEq(getField(post, "title"), "Hello World", "post.title matches");
                assertEq(getField(post, "viewCount"), 42, "post.viewCount matches");
            }
        }

        if (failed > 0) {
            System.err.printf("%n%d assertion(s) failed%n", failed);
            System.exit(1);
        }
        System.out.println("\nAll assertions passed!");
    }

    static void setField(Object obj, String name, Object value) throws Exception {
        Field f = obj.getClass().getDeclaredField(name);
        f.setAccessible(true);
        f.set(obj, value);
    }

    static Object getField(Object obj, String name) throws Exception {
        Field f = obj.getClass().getDeclaredField(name);
        f.setAccessible(true);
        return f.get(obj);
    }
}
