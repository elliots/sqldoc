import java.time.LocalDateTime;

public record StaffAuditLog(
    long id,
    String tableName,
    String operation,
    String oldData,
    String newData,
    LocalDateTime changedAt
) {}
