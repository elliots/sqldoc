import java.math.BigDecimal;
import java.time.LocalDateTime;

public record Pet(
    int id,
    Integer categoryId,
    String name,
    String sku,
    BigDecimal price,
    String internalNotes,
    String status,
    LocalDateTime createdAt
) {}
