import java.time.OffsetDateTime;

public record AdoptionsAuditLog(
    long id,
    String tableName,
    String operation,
    String oldData,
    String newData,
    OffsetDateTime changedAt
) {}
