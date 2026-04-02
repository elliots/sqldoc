import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "adoptions")
public class Adoption {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;

    @ManyToOne
    @JoinColumn(name = "pet_id")
    @Column(nullable = false)
    private int petId;

    @ManyToOne
    @JoinColumn(name = "owner_id")
    @Column(nullable = false)
    private int ownerId;

    @Column(nullable = false)
    private LocalDateTime adoptedAt;

    @Column(nullable = false)
    private BigDecimal adoptionFee;

}
