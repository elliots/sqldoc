import java.math.BigDecimal;
import java.time.LocalDateTime;

public record Adoption(
    int id,
    int petId,
    int ownerId,
    LocalDateTime adoptedAt,
    BigDecimal adoptionFee,
    String updatedBy
) {}
