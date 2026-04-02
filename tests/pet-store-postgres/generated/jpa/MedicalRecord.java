import jakarta.persistence.*;
import java.time.LocalDate;

@Entity
@Table(name = "medical_records")
public class MedicalRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;

    @ManyToOne
    @JoinColumn(name = "pet_id")
    @Column(nullable = false)
    private int petId;

    @Column(nullable = false)
    private LocalDate visitDate;

    @Column(nullable = false)
    private String diagnosis;

    private String treatment;

    private String vetName;

}
