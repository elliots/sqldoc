import java.time.LocalDateTime;

public record Review(
    int id,
    int petId,
    int ownerId,
    int rating,
    String body,
    Integer locationId,
    LocalDateTime createdAt
) {}
