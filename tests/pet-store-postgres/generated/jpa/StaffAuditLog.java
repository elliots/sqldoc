import jakarta.persistence.*;
import java.time.OffsetDateTime;

@Entity
@Table(name = "staff_audit_log")
public class StaffAuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private long id;

    @Column(nullable = false)
    private String tableName;

    @Column(nullable = false)
    private String operation;

    private String oldData;

    private String newData;

    @Column(nullable = false)
    private OffsetDateTime changedAt;

}
