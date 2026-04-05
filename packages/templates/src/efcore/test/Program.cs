// Integration test for @sqldoc/templates/efcore
// Connects to real Postgres via EF Core + Npgsql, verifies generated entities work.
using Microsoft.EntityFrameworkCore;
using Generated;

var databaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL");
if (string.IsNullOrEmpty(databaseUrl))
{
    Console.Error.WriteLine("DATABASE_URL not set");
    Environment.Exit(1);
}

// Enable legacy timestamp behavior so DateTimeOffset works with timestamptz
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

// Convert postgres(ql)://user:pass@host:port/db to Npgsql connection string
var uri = new Uri(databaseUrl.Replace("postgresql://", "http://").Replace("postgres://", "http://"));
var userInfo = uri.UserInfo.Split(':', 2);
var connectionString = $"Host={uri.Host};Port={(uri.Port > 0 ? uri.Port : 5432)};Database={uri.AbsolutePath.TrimStart('/')};Username={userInfo[0]};Password={userInfo[1]}";

var failed = 0;

void Assert(bool condition, string msg)
{
    if (!condition)
    {
        Console.Error.WriteLine($"FAIL: {msg}");
        failed++;
    }
    else
    {
        Console.WriteLine($"  ok: {msg}");
    }
}

Console.WriteLine("--- efcore integration test ---");

var options = new DbContextOptionsBuilder<TestDbContext>()
    .UseNpgsql(connectionString)
    .UseSnakeCaseNamingConvention()
    .Options;

using (var db = new TestDbContext(options))
{
    // 1. Query known seeded user
    var user = db.Users.FirstOrDefault(u => u.Id == 1);
    Assert(user != null, "seeded user found");
    Assert(user!.Email == "test@example.com", "user email matches");
    Assert(user.Name == "Test User", "user name matches");
    Assert(user.Age == 30, "user age matches");
    Assert(user.IsActive == true, "user is_active matches");

    // 2. Query known seeded post (content schema)
    var post = db.ContentPosts.FirstOrDefault(p => p.Id == 1);
    Assert(post != null, "seeded post found");
    Assert(post!.Title == "Hello World", "post title matches");
    Assert(post.Body == "First post body", "post body matches");
    Assert(post.ViewCount == 42, "post view_count matches");
    Assert(post.Rating == 4.5, "post rating matches");

    // 3. Query known seeded comment
    var comment = db.Comments.FirstOrDefault(c => c.Id == 1);
    Assert(comment != null, "seeded comment found");
    Assert(comment!.Content == "Great post!", "comment content matches");
}

if (failed > 0)
{
    Console.Error.WriteLine($"\n{failed} assertion(s) failed");
    Environment.Exit(1);
}
Console.WriteLine("\nAll assertions passed!");

public class TestDbContext : DbContext
{
    public TestDbContext(DbContextOptions<TestDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<ContentPost> ContentPosts => Set<ContentPost>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<PostTag> PostTags => Set<PostTag>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // UseSnakeCaseNamingConvention handles column and table name mapping.
        // ContentPost already has [Table("posts", Schema = "content")].

        // PostTag has composite key (EF Core requires Fluent API for composite keys)
        modelBuilder.Entity<PostTag>().HasKey(pt => new { pt.PostId, pt.TagId });

        // ActiveUser is keyless (view)
        modelBuilder.Entity<ActiveUser>().HasNoKey().ToView("active_users");

        // Address is a PostgreSQL composite type -- ignore for now
        modelBuilder.Entity<User>().Ignore(u => u.Address);
    }
}
