import org.hibernate.boot.MetadataSources;
import org.hibernate.boot.registry.StandardServiceRegistryBuilder;
import jakarta.persistence.*;
import java.util.List;

/**
 * Integration test for @sqldoc/templates/jpa
 * Verifies generated JPA entities work with real Hibernate against a seeded database.
 */
public class Test {
    static int failed = 0;

    static void assertEq(Object actual, Object expected, String msg) {
        if (actual == null && expected == null) {
            System.out.printf("  ok: %s%n", msg);
        } else if (actual == null || !actual.equals(expected)) {
            System.err.printf("FAIL: %s (got %s, expected %s)%n", msg, actual, expected);
            failed++;
        } else {
            System.out.printf("  ok: %s%n", msg);
        }
    }

    static void assertNotNull(Object actual, String msg) {
        if (actual == null) {
            System.err.printf("FAIL: %s (was null)%n", msg);
            failed++;
        } else {
            System.out.printf("  ok: %s%n", msg);
        }
    }

    public static void main(String[] args) {
        String dbUrl = System.getenv("DATABASE_URL");
        if (dbUrl == null || dbUrl.isEmpty()) {
            System.err.println("DATABASE_URL not set");
            System.exit(1);
        }

        // Convert postgres(ql):// to jdbc:postgresql://
        var uri = java.net.URI.create(dbUrl.replaceFirst("^postgres(ql)?://", "http://"));
        var userInfo = uri.getUserInfo();
        var jdbcUrl = "jdbc:postgresql://" + uri.getHost() + ":" + (uri.getPort() > 0 ? uri.getPort() : 5432) + uri.getPath();
        var query = uri.getQuery();
        String jdbcUser = null;
        String jdbcPass = null;
        if (userInfo != null) {
            var parts = userInfo.split(":", 2);
            jdbcUser = parts[0];
            jdbcPass = parts.length > 1 ? parts[1] : "";
        }
        if (query != null) {
            jdbcUrl += "?" + query;
        }

        System.out.println("--- jpa integration test (Hibernate) ---");

        var registryBuilder = new StandardServiceRegistryBuilder()
            .applySetting("hibernate.connection.url", jdbcUrl)
            .applySetting("hibernate.connection.driver_class", "org.postgresql.Driver")
            .applySetting("hibernate.hbm2ddl.auto", "none")
            .applySetting("hibernate.default_schema", "public")
            .applySetting("hibernate.show_sql", "true");

        if (jdbcUser != null) {
            registryBuilder.applySetting("hibernate.connection.username", jdbcUser);
            registryBuilder.applySetting("hibernate.connection.password", jdbcPass);
        }

        var registry = registryBuilder.build();

        EntityManagerFactory emf;
        try {
            emf = new MetadataSources(registry)
                .addAnnotatedClass(User.class)
                .addAnnotatedClass(ContentPost.class)
                .addAnnotatedClass(Comment.class)
                .addAnnotatedClass(PostTag.class)
                .addAnnotatedClass(ActiveUser.class)
                .buildMetadata()
                .buildSessionFactory();
        } catch (Exception e) {
            System.err.println("FAIL: Hibernate SessionFactory creation failed");
            e.printStackTrace();
            System.exit(1);
            return;
        }

        System.out.println("SessionFactory created successfully.");

        EntityManager em = emf.createEntityManager();
        try {
            // --- User ---
            User user = em.find(User.class, 1L);
            assertNotNull(user, "User with id=1 found");
            assertEq(user.email, "test@example.com", "user.email matches");
            assertEq(user.name, "Test User", "user.name matches");
            assertEq(user.age, Integer.valueOf(30), "user.age matches");
            assertEq(user.isActive, true, "user.isActive matches");

            // --- Address (composite type via AttributeConverter) ---
            em.getTransaction().begin();
            em.createNativeQuery("UPDATE users SET address = ROW('123 Main St', 'Springfield', '62701', 'US')::address WHERE id = 1").executeUpdate();
            em.getTransaction().commit();
            em.clear();

            User userWithAddr = em.find(User.class, 1L);
            assertNotNull(userWithAddr.address, "user.address loaded via @Struct");
            assertEq(userWithAddr.address.street, "123 Main St", "address.street matches");
            assertEq(userWithAddr.address.city, "Springfield", "address.city matches");
            assertEq(userWithAddr.address.zip, "62701", "address.zip matches");
            assertEq(userWithAddr.address.country, "US", "address.country matches");

            // --- ContentPost (content schema) ---
            ContentPost post = em.find(ContentPost.class, 1L);
            assertNotNull(post, "ContentPost with id=1 found");
            assertEq(post.title, "Hello World", "post.title matches");
            assertEq(post.body, "First post body", "post.body matches");
            assertEq(post.viewCount, 42, "post.viewCount matches");
            assertEq(post.rating, 4.5, "post.rating matches");

            // --- Comment ---
            Comment comment = em.find(Comment.class, 1L);
            assertNotNull(comment, "Comment with id=1 found");
            assertEq(comment.content, "Great post!", "comment.content matches");

            // --- Cross-schema FK: Comment -> ContentPost ---
            assertNotNull(comment.post, "comment.post relation loaded");
            assertEq(comment.post.title, "Hello World", "comment -> post FK resolved across schemas");

            // --- JPQL ---
            List<User> users = em.createQuery("SELECT u FROM User u WHERE u.email = :email", User.class)
                .setParameter("email", "test@example.com")
                .getResultList();
            assertEq(users.size(), 1, "JPQL finds 1 user by email");

            List<ContentPost> posts = em.createQuery("SELECT p FROM ContentPost p WHERE p.viewCount > :min", ContentPost.class)
                .setParameter("min", 0)
                .getResultList();
            assertEq(posts.size(), 1, "JPQL finds 1 post with viewCount > 0");

        } catch (Exception e) {
            System.err.println("FAIL: Exception during entity queries");
            e.printStackTrace();
            failed++;
        } finally {
            em.close();
            emf.close();
        }

        if (failed > 0) {
            System.err.printf("%n%d assertion(s) failed%n", failed);
            System.exit(1);
        }
        System.out.println("\nAll assertions passed!");
    }
}
