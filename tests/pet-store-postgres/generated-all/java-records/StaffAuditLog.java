import java.time.OffsetDateTime;

public record StaffAuditLog(
    long id,
    String tableName,
    String operation,
    String oldData,
    String newData,
    OffsetDateTime changedAt
) {}
