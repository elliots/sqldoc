import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "adoptions")
public class Adoption {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public int id;

    @ManyToOne
    @JoinColumn(name = "pet_id")
    public Pet pet;

    @ManyToOne
    @JoinColumn(name = "owner_id")
    public Owner owner;

    @Column(name = "adopted_at", nullable = false)
    public LocalDateTime adoptedAt;

    @Column(name = "adoption_fee", nullable = false)
    public BigDecimal adoptionFee;

}
