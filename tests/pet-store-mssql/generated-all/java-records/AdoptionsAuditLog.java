import java.time.LocalDateTime;

public record AdoptionsAuditLog(
    long id,
    String tableName,
    String operation,
    String oldData,
    String newData,
    LocalDateTime changedAt
) {}
