import jakarta.persistence.*;
import java.time.LocalDate;

@Entity
@Table(name = "medical_records")
public class MedicalRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public int id;

    @ManyToOne
    @JoinColumn(name = "pet_id")
    public Pet pet;

    @Column(name = "visit_date", nullable = false)
    public LocalDate visitDate;

    @Column(nullable = false)
    public String diagnosis;

    public String treatment;

    @Column(name = "vet_name")
    public String vetName;

}
