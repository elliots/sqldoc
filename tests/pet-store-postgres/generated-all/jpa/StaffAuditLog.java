import jakarta.persistence.*;
import java.time.OffsetDateTime;

@Entity
@Table(name = "staff_audit_log")
public class StaffAuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "table_name", nullable = false)
    public String tableName;

    @Column(nullable = false)
    public String operation;

    @Column(name = "old_data")
    public String oldData;

    @Column(name = "new_data")
    public String newData;

    @Column(name = "changed_at", nullable = false)
    public OffsetDateTime changedAt;

}
