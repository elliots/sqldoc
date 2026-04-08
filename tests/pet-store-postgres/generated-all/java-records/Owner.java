import java.time.LocalDateTime;

public record Owner(
    int id,
    String name,
    String email,
    String phone,
    LocalDateTime createdAt
) {}
